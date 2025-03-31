import os
import io
import uuid
import json # For parsing placement data
from flask import Flask, render_template, request, send_file, jsonify, abort
import fitz  # PyMuPDF
from PIL import Image, ImageChops # Pillow for image processing

# --- Configuration ---
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS_IMG = {'png', 'jpg', 'jpeg', 'gif'}
ALLOWED_EXTENSIONS_PDF = {'pdf'}
# Tolerance for background color matching (0-255). Adjust as needed.
BACKGROUND_REMOVAL_TOLERANCE = 30

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 64 * 1024 * 1024  # Increased limit for multiple files

# --- Helper Functions ---
def allowed_file(filename, allowed_set):
    """Checks if the file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in allowed_set

def ensure_upload_folder():
    """Creates the upload folder if it doesn't exist."""
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])

def remove_background(image_bytes, tolerance=BACKGROUND_REMOVAL_TOLERANCE):
    """
    Removes the background of an image, assuming the top-left pixel is representative.
    Returns bytes of the processed PNG image.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        width, height = img.size

        # Get the background color (using top-left pixel)
        # Consider sampling more points (e.g., corners, center of edges) for robustness
        bg_pixel = img.getpixel((0, 0))

        # Create threshold mask: pixels matching background (within tolerance) will be white
        # Note: This uses PIL's built-in operations which can be faster than pixel iteration
        bg_color_img = Image.new("RGBA", (width, height), bg_pixel)
        diff = ImageChops.difference(img, bg_color_img)

        # Calculate bounds for tolerance (might need refinement depending on colorspace)
        lower_bound = tuple(max(0, c - tolerance) for c in (0,0,0)) # Compare diff against black + tolerance
        upper_bound = tuple(min(255, c + tolerance) for c in (0,0,0)) # (tolerance, tolerance, tolerance) effectively

        # Create a mask where pixels *outside* tolerance are white, others black
        # This seems inverted - let's stick to pixel iteration for clarity first. Revisit if slow.

        newData = []
        for item in img.getdata():
            # Check if RGB values are within tolerance of the background pixel's RGB
            is_background = True
            for i in range(3): # Check R, G, B channels
                if not (bg_pixel[i] - tolerance <= item[i] <= bg_pixel[i] + tolerance):
                    is_background = False
                    break
            # Also consider alpha if the original might have some transparency near edge
            if bg_pixel[3] < 255 and item[3] < 50: # Treat very low alpha as background too
                is_background = True

            if is_background:
                newData.append((255, 255, 255, 0)) # Make background transparent white
            else:
                newData.append(item) # Keep original pixel (including its alpha)

        img.putdata(newData)

        # Save processed image to bytes buffer as PNG
        output_buffer = io.BytesIO()
        img.save(output_buffer, format="PNG")
        img.close()
        output_buffer.seek(0)
        return output_buffer.getvalue()

    except Exception as e:
        app.logger.error(f"Error removing background: {e}", exc_info=True)
        # Fallback: return original bytes if processing fails
        return image_bytes

# --- Routes ---
@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/sign', methods=['POST'])
def sign_pdf():
    """Handles PDF and MULTIPLE signatures, places them, returns signed PDF."""
    ensure_upload_folder()
    pdf_file = None
    pdf_path = None
    temp_files_to_clean = [] # Keep track of all temp files

    try:
        # 1. Validate PDF Input
        if 'pdfFile' not in request.files:
            abort(400, description="Missing PDF file.")
        pdf_file = request.files['pdfFile']
        if pdf_file.filename == '':
             abort(400, description="No selected PDF file.")
        if not allowed_file(pdf_file.filename, ALLOWED_EXTENSIONS_PDF):
            abort(400, description="Invalid PDF file type.")

        # 2. Validate Placements Data
        if 'placements' not in request.form:
            abort(400, description="Missing signature placement data.")
        try:
            placements = json.loads(request.form['placements'])
            if not isinstance(placements, list):
                raise ValueError("Placements data is not a list.")
            if not placements:
                 abort(400, description="No signatures were placed.")
        except (json.JSONDecodeError, ValueError) as e:
            app.logger.error(f"Invalid placements JSON: {e}")
            abort(400, description=f"Invalid placement data format: {e}")

        # 3. Get Rendered Page Dimensions (Assume consistent for the session)
        try:
            page_w_px = float(request.form['pageWidthPx'])
            page_h_px = float(request.form['pageHeightPx'])
            if page_w_px <= 0 or page_h_px <= 0:
                 raise ValueError("Invalid page dimensions.")
        except (KeyError, ValueError) as e:
             app.logger.error(f"Invalid page dimension data: {e}")
             abort(400, description=f"Missing or invalid page dimension data: {e}")


        # 4. Handle Uploaded Signature Files
        signature_files_map = {} # Map signatureId to temporary file path
        # Expecting keys like 'signatureFiles[signatureId]' from frontend
        for key in request.files:
             if key.startswith('signatureFiles['):
                sig_id = key[len('signatureFiles['):-1] # Extract ID
                sig_file = request.files[key]

                if sig_file and sig_file.filename != '' and allowed_file(sig_file.filename, ALLOWED_EXTENSIONS_IMG):
                    # Save signature temporarily
                    sig_filename = f"{uuid.uuid4()}_{sig_file.filename}"
                    sig_path = os.path.join(app.config['UPLOAD_FOLDER'], sig_filename)
                    sig_file.save(sig_path)
                    signature_files_map[sig_id] = sig_path
                    temp_files_to_clean.append(sig_path)
                    app.logger.info(f"Saved signature {sig_id} to {sig_path}")
                else:
                    app.logger.warning(f"Skipping invalid signature file for ID {sig_id}: {sig_file.filename}")
                    # Don't abort, maybe user placed signatures but didn't upload all? Or uploaded invalid ones.


        # 5. Save Temporary PDF File
        pdf_filename = f"{uuid.uuid4()}.pdf"
        pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], pdf_filename)
        pdf_file.save(pdf_path)
        temp_files_to_clean.append(pdf_path)

        # --- PyMuPDF Processing ---
        doc = fitz.open(pdf_path)
        processed_signatures = {} # Cache processed signature bytes (with bg removed)

        # 6. Iterate Through Placements and Apply Signatures
        for i, placement in enumerate(placements):
            try:
                sig_id = str(placement['signatureId']) # Ensure string comparison
                page_num = int(placement['pageNum']) # 0-based index from JS
                x_px = float(placement['x'])
                y_px = float(placement['y'])
                sig_w_px = float(placement['widthPx'])
                sig_h_px = float(placement['heightPx'])

                # Basic validation of placement data
                if sig_w_px <= 0 or sig_h_px <= 0:
                    app.logger.warning(f"Skipping placement {i} due to invalid dimensions.")
                    continue
                if page_num < 0 or page_num >= len(doc):
                     app.logger.warning(f"Skipping placement {i} due to invalid page number {page_num+1}.")
                     continue
                if sig_id not in signature_files_map:
                    app.logger.warning(f"Skipping placement {i} because signature ID {sig_id} was not uploaded or invalid.")
                    continue

                # Process signature image (remove background) if not already done
                if sig_id not in processed_signatures:
                    sig_path = signature_files_map[sig_id]
                    with open(sig_path, 'rb') as f_sig:
                        original_bytes = f_sig.read()
                    processed_bytes = remove_background(original_bytes)
                    processed_signatures[sig_id] = processed_bytes
                    app.logger.info(f"Processed background for signature {sig_id}")

                target_page = doc[page_num]
                page_rect = target_page.rect
                page_width_pt = page_rect.width
                # CORRECTLY GET page_height_pt from page_rect
                page_height_pt = page_rect.height # PDF page height in points
                # REMOVED THE ERRONEOUS LINE: page_height_pt = page_height_pt

                # Calculate scaling factors (remains the same)
                scale_x = page_width_pt / page_w_px
                scale_y = page_height_pt / page_h_px

                # Calculate signature dimensions in points (remains the same)
                sig_w_pt = sig_w_px * scale_x
                sig_h_pt = sig_h_px * scale_y

                # --- *** TEST: ASSUME insert_image USES TOP-LEFT Y-ORIGIN *** ---

                # Calculate the signature's top edge distance from the PDF page's top edge, in points.
                y_pt_from_top = y_px * scale_y

                # Directly use this as the 'y0' coordinate, assuming insert_image uses it as the top edge.
                y0_for_insert = y_pt_from_top

                # Calculate the 'y1' coordinate (bottom edge relative to top-left origin)
                y1_for_insert = y0_for_insert + sig_h_pt

                # --- *** END TEST CALCULATION *** ---

                # Calculate X position in points (remains the same)
                x0 = x_px * scale_x # Left edge
                x1 = x0 + sig_w_pt   # Right edge

                # Define the rectangle using the calculated values based on the hypothesis
                signature_rect_for_insert = fitz.Rect(x0, y0_for_insert, x1, y1_for_insert)


                # --- Add Logging ---
                app.logger.debug(f"Placement {i} (SigID {sig_id}, Page {page_num}):")
                app.logger.debug(f"  Input Pixels: x={x_px:.2f}, y={y_px:.2f}, w={sig_w_px:.2f}, h={sig_h_px:.2f}")
                # ... (keep other debug logs) ...
                app.logger.debug(f"  TEST CALC: y_pt_from_top={y_pt_from_top:.2f}")
                app.logger.debug(f"  TEST CALC RECT for insert_image: {signature_rect_for_insert}")
                # --- End Logging ---


                # Clamp X coordinate, leave Y unclamped for this test
                x0_clamped = max(0.0, min(x0, page_width_pt - sig_w_pt))
                x1_clamped = x0_clamped + sig_w_pt
                # Create the final rect using clamped X and the hypothesized Y values
                final_rect_to_insert = fitz.Rect(x0_clamped, y0_for_insert, x1_clamped, y1_for_insert)
                app.logger.info(f"Final Rect used for insertion (Top-Left Y hypothesis): {final_rect_to_insert}")


                # Insert the PROCESSED signature image bytes
                target_page.insert_image(
                    final_rect_to_insert, # Use the rect calculated with the top-left Y hypothesis
                    stream=processed_signatures[sig_id]
                )

            except (KeyError, ValueError, TypeError) as e:
                app.logger.warning(f"Skipping placement {i} due to invalid data: {e}")
                continue # Skip to next placement

        # 7. Save Modified PDF to Memory Stream
        output_stream = io.BytesIO()
        doc.save(output_stream, garbage=4, deflate=True)
        doc.close() # Close the document
        output_stream.seek(0)

        # 8. Send the Signed PDF
        return send_file(
            output_stream,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='signed_document.pdf'
        )

    except Exception as e:
        app.logger.error(f"An error occurred: {e}", exc_info=True)
        if hasattr(e, 'code') and 400 <= e.code < 500:
             abort(e.code, description=e.description)
        abort(500, description="An internal server error occurred during signing.")

    finally:
        # 9. Cleanup ALL Temporary Files
        for temp_path in temp_files_to_clean:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                    app.logger.info(f"Cleaned up temp file: {temp_path}")
                except OSError as e:
                     app.logger.error(f"Error removing temp file {temp_path}: {e}")


# Error Handler remains the same...
@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(500)
def handle_error(error):
    """Generic JSON error handler."""
    response = jsonify({
        'error': {
            'type': error.name,
            'message': error.description or 'An error occurred.'
        }
    })
    response.status_code = error.code if hasattr(error, 'code') else 500
    return response


# Main Execution remains the same...
if __name__ == '__main__':
    ensure_upload_folder()
    app.run(debug=True)