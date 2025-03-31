import os
import io
import uuid
import json
from flask import Flask, render_template, request, send_file, jsonify, abort
import fitz  # PyMuPDF
from PIL import Image, ImageChops

# --- Configuration (remains the same) ---
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS_IMG = {'png', 'jpg', 'jpeg', 'gif'}
ALLOWED_EXTENSIONS_PDF = {'pdf'}
BACKGROUND_REMOVAL_TOLERANCE = 30

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 64 * 1024 * 1024

# --- Helper Functions (remains the same) ---
def allowed_file(filename, allowed_set):
    """Checks if the file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in allowed_set

def ensure_upload_folder():
    """Creates the upload folder if it doesn't exist."""
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])

def remove_background(image_bytes, tolerance=BACKGROUND_REMOVAL_TOLERANCE):
    """Removes the background, returns PNG bytes."""
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        # Ensure background pixel is taken correctly even if image has palette
        # If image has palette, convert it first for reliable getpixel
        if img.mode == 'P':
             img = img.convert("RGBA")

        bg_pixel = img.getpixel((0, 0))

        newData = []
        for item in img.getdata():
            is_background = True
            # Compare RGB values within tolerance
            if len(item) >= 3 and len(bg_pixel) >=3: # Check if color info exists
                for i in range(3):
                    if not (bg_pixel[i] - tolerance <= item[i] <= bg_pixel[i] + tolerance):
                        is_background = False
                        break
            else: # Handle grayscale or modes without full RGB
                # Simple brightness check for grayscale (might need adjustment)
                if not (bg_pixel[0] - tolerance <= item[0] <= bg_pixel[0] + tolerance):
                     is_background = False

            # Consider alpha: if background is transparent-ish, match low alpha
            # Also, if the pixel has low alpha, treat it as background regardless of color match
            if len(item) > 3 and len(bg_pixel) > 3: # Check if alpha exists
                 if bg_pixel[3] < 200 and item[3] < 50: # Background somewhat transparent AND pixel transparent
                     is_background = True
                 elif item[3] < 20: # Treat very transparent pixels as background
                     is_background = True


            if is_background:
                newData.append((255, 255, 255, 0)) # Transparent white
            else:
                newData.append(item) # Keep original pixel

        img.putdata(newData)

        output_buffer = io.BytesIO()
        img.save(output_buffer, format="PNG") # Always save as PNG for transparency
        img.close()
        output_buffer.seek(0)
        return output_buffer.getvalue()

    except Exception as e:
        app.logger.error(f"Error removing background: {e}", exc_info=True)
        raise ValueError(f"Failed to process image: {e}") # Re-raise for handling


# --- Routes ---
@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

# --- NEW ROUTE: /convert_signature ---
@app.route('/convert_signature', methods=['POST'])
def convert_signature_route():
    """Handles single signature upload, removes background, returns PNG."""
    if 'signatureFile' not in request.files:
        abort(400, description="Missing 'signatureFile' in request.")

    sig_file = request.files['signatureFile']

    if sig_file.filename == '':
        abort(400, description="No file selected.")

    if not allowed_file(sig_file.filename, ALLOWED_EXTENSIONS_IMG):
        abort(400, description="Invalid file type. Allowed: PNG, JPG, GIF.")

    try:
        image_bytes = sig_file.read()
        processed_bytes = remove_background(image_bytes) # Call the existing helper

        return send_file(
            io.BytesIO(processed_bytes),
            mimetype='image/png',
            as_attachment=True,
            download_name='signature_transparent.png'
        )

    except ValueError as e: # Catch errors from remove_background
         app.logger.error(f"Conversion error: {e}")
         abort(400, description=str(e)) # Send specific error back
    except Exception as e:
        app.logger.error(f"Unexpected conversion error: {e}", exc_info=True)
        abort(500, description="Server error during image processing.")


# --- PDF Signing Route (remains the same - using the last working version) ---
@app.route('/sign', methods=['POST'])
def sign_pdf():
    """Handles PDF and MULTIPLE signatures, places them, returns signed PDF."""
    ensure_upload_folder()
    pdf_file = None
    pdf_path = None
    temp_files_to_clean = []

    try:
        # 1. Validate PDF Input
        if 'pdfFile' not in request.files:
            abort(400, description="Missing PDF file.")
        pdf_file = request.files['pdfFile']
        if pdf_file.filename == '' or not allowed_file(pdf_file.filename, ALLOWED_EXTENSIONS_PDF):
            abort(400, description="Invalid or missing PDF file.")

        # 2. Validate Placements Data
        if 'placements' not in request.form: abort(400, description="Missing signature placement data.")
        try:
            placements = json.loads(request.form['placements'])
            if not isinstance(placements, list) or not placements:
                raise ValueError("Placements data must be a non-empty list.")
        except (json.JSONDecodeError, ValueError) as e:
            abort(400, description=f"Invalid placement data format: {e}")

        # 3. Get Rendered Page Dimensions
        try:
            page_w_px = float(request.form['pageWidthPx'])
            page_h_px = float(request.form['pageHeightPx'])
            if page_w_px <= 0 or page_h_px <= 0: raise ValueError("Invalid page dimensions.")
        except (KeyError, ValueError) as e:
            abort(400, description=f"Missing or invalid page dimension data: {e}")

        # 4. Handle Uploaded Signature Files
        signature_files_map = {}
        for key in request.files:
             if key.startswith('signatureFiles['):
                sig_id = key[len('signatureFiles['):-1]
                sig_file = request.files[key]
                if sig_file and sig_file.filename != '' and allowed_file(sig_file.filename, ALLOWED_EXTENSIONS_IMG):
                    sig_filename = f"{uuid.uuid4()}_{sig_file.filename}"
                    sig_path = os.path.join(app.config['UPLOAD_FOLDER'], sig_filename)
                    sig_file.save(sig_path)
                    signature_files_map[sig_id] = sig_path
                    temp_files_to_clean.append(sig_path)
                else:
                    app.logger.warning(f"Skipping invalid signature file for ID {sig_id}")

        # 5. Save Temporary PDF File
        pdf_filename = f"{uuid.uuid4()}.pdf"
        pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], pdf_filename)
        pdf_file.save(pdf_path)
        temp_files_to_clean.append(pdf_path)

        # --- PyMuPDF Processing ---
        doc = fitz.open(pdf_path)
        processed_signatures = {}

        # 6. Iterate Through Placements and Apply Signatures
        for i, placement in enumerate(placements):
            try:
                sig_id = str(placement['signatureId'])
                page_num = int(placement['pageNum'])
                x_px = float(placement['x'])
                y_px = float(placement['y'])
                sig_w_px = float(placement['widthPx'])
                sig_h_px = float(placement['heightPx'])

                if sig_w_px <= 0 or sig_h_px <= 0 or page_num < 0 or page_num >= len(doc) or sig_id not in signature_files_map:
                    app.logger.warning(f"Skipping placement {i} due to invalid data or missing signature file.")
                    continue

                if sig_id not in processed_signatures:
                    sig_path = signature_files_map[sig_id]
                    with open(sig_path, 'rb') as f_sig:
                        original_bytes = f_sig.read()
                    # Use background removal during signing process as well
                    processed_bytes = remove_background(original_bytes)
                    processed_signatures[sig_id] = processed_bytes
                    app.logger.info(f"Processed background for signature {sig_id} during signing.")

                target_page = doc[page_num]
                page_rect = target_page.rect
                page_width_pt = page_rect.width
                page_height_pt = page_rect.height

                scale_x = page_width_pt / page_w_px
                scale_y = page_height_pt / page_h_px
                sig_w_pt = sig_w_px * scale_x
                sig_h_pt = sig_h_px * scale_y

                # Using the calculation that assumes insert_image uses top-left Y origin
                y_pt_from_top = y_px * scale_y
                y0_for_insert = y_pt_from_top
                y1_for_insert = y0_for_insert + sig_h_pt
                x0 = x_px * scale_x
                x1 = x0 + sig_w_pt

                # Clamp X, use hypothesized Y
                x0_clamped = max(0.0, min(x0, page_width_pt - sig_w_pt))
                x1_clamped = x0_clamped + sig_w_pt
                final_rect_to_insert = fitz.Rect(x0_clamped, y0_for_insert, x1_clamped, y1_for_insert)
                app.logger.info(f"Final Rect used for insertion: {final_rect_to_insert}")

                target_page.insert_image( final_rect_to_insert, stream=processed_signatures[sig_id] )

            except (KeyError, ValueError, TypeError) as e:
                app.logger.warning(f"Skipping placement {i} due to invalid data: {e}")
                continue

        # 7. Save Modified PDF to Memory Stream
        output_stream = io.BytesIO()
        doc.save(output_stream, garbage=4, deflate=True)
        doc.close()
        output_stream.seek(0)

        # 8. Send the Signed PDF
        return send_file( output_stream, mimetype='application/pdf', as_attachment=True, download_name='signed_document.pdf' )

    except Exception as e:
        app.logger.error(f"An error occurred during signing: {e}", exc_info=True)
        if hasattr(e, 'code') and 400 <= e.code < 500: abort(e.code, description=e.description)
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

# --- Error Handler (remains the same) ---
@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(500)
def handle_error(error):
    """Generic JSON error handler."""
    response = jsonify({
        'error': {
            'type': error.name if hasattr(error, 'name') else 'Error',
            'message': getattr(error, 'description', 'An error occurred.')
        }
    })
    response.status_code = getattr(error, 'code', 500)
    return response

# --- Main Execution (remains the same) ---

def main():
    ensure_upload_folder()
    app.run(debug=True)

if __name__ == '__main__':
    main()
