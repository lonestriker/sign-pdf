import os
import io
import uuid
from flask import Flask, render_template, request, send_file, jsonify, abort
import fitz  # PyMuPDF
from PIL import Image # Pillow for potentially more robust image handling

# --- Configuration ---
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS_IMG = {'png', 'jpg', 'jpeg', 'gif'} # Although fitz primarily handles png/jpg best
ALLOWED_EXTENSIONS_PDF = {'pdf'}

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # Limit uploads to 32MB

# --- Helper Functions ---
def allowed_file(filename, allowed_set):
    """Checks if the file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in allowed_set

def ensure_upload_folder():
    """Creates the upload folder if it doesn't exist."""
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])

# --- Routes ---
@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/sign', methods=['POST'])
def sign_pdf():
    """Handles PDF and signature upload, places signature, returns signed PDF."""
    ensure_upload_folder()
    pdf_file = None
    signature_file = None
    pdf_path = None
    signature_path = None
    output_stream = None

    try:
        # 1. Validate Input Files
        if 'pdfFile' not in request.files or 'signatureFile' not in request.files:
            abort(400, description="Missing PDF or signature file.")

        pdf_file = request.files['pdfFile']
        signature_file = request.files['signatureFile']

        if pdf_file.filename == '' or signature_file.filename == '':
             abort(400, description="No selected file.")

        if not allowed_file(pdf_file.filename, ALLOWED_EXTENSIONS_PDF):
            abort(400, description="Invalid PDF file type.")

        if not allowed_file(signature_file.filename, ALLOWED_EXTENSIONS_IMG):
             abort(400, description="Invalid signature image type (PNG, JPG, GIF allowed).")

        # 2. Validate Metadata
        try:
            page_num = int(request.form['pageNum']) # 0-based index expected from JS
            # Coordinates and dimensions from the *rendered* elements on the frontend
            x_px = float(request.form['x'])
            y_px = float(request.form['y'])
            sig_w_px = float(request.form['signatureWidthPx'])
            sig_h_px = float(request.form['signatureHeightPx'])
            page_w_px = float(request.form['pageWidthPx'])
            page_h_px = float(request.form['pageHeightPx'])
        except (KeyError, ValueError) as e:
            app.logger.error(f"Invalid form data: {e}")
            abort(400, description=f"Missing or invalid placement data: {e}")

        # 3. Save Temporary Files
        pdf_filename = f"{uuid.uuid4()}.pdf"
        signature_filename = f"{uuid.uuid4()}_{signature_file.filename}"
        pdf_path = os.path.join(app.config['UPLOAD_FOLDER'], pdf_filename)
        signature_path = os.path.join(app.config['UPLOAD_FOLDER'], signature_filename)

        pdf_file.save(pdf_path)
        signature_file.save(signature_path)

        # --- PyMuPDF Processing ---
        doc = fitz.open(pdf_path)

        if page_num < 0 or page_num >= len(doc):
            abort(400, description=f"Invalid page number: {page_num+1}. PDF has {len(doc)} pages.")

        page = doc[page_num] # Get the target page

        # 4. Get Actual PDF Page Dimensions (in points)
        page_rect = page.rect
        page_width_pt = page_rect.width
        page_height_pt = page_rect.height

        # 5. Calculate Signature Position and Size in PDF points
        #    - Calculate scaling factors based on rendered vs actual page size
        scale_x = page_width_pt / page_w_px
        scale_y = page_height_pt / page_h_px

        #    - Calculate signature dimensions in points
        #      Maintain aspect ratio from the pixel dimensions provided
        sig_w_pt = sig_w_px * scale_x
        sig_h_pt = sig_h_px * scale_y

        #    - Calculate top-left position in points (PDF coordinates)
        #      Remember: PDF Y-coordinate originates at the BOTTOM-left.
        #      Frontend Y-coordinate originates at the TOP-left.
        x_pt = x_px * scale_x
        # y_pt represents the distance from the *top* edge in points
        y_pt_from_top = y_px * scale_y

        # Define the rectangle for insertion using PDF coordinates (bottom-left origin)
        # rect = fitz.Rect(x0, y0, x1, y1)
        # x0 = left edge
        # y0 = bottom edge
        # x1 = right edge
        # y1 = top edge
        x0 = x_pt
        y1 = page_height_pt - y_pt_from_top # Top edge relative to bottom
        x1 = x0 + sig_w_pt
        y0 = y1 - sig_h_pt                 # Bottom edge relative to bottom

        signature_rect = fitz.Rect(x0, y0, x1, y1)

        # 6. Insert the Signature Image
        #    PyMuPDF handles transparency for PNGs well.
        #    It can often directly load JPG, PNG. Use Pillow for more complex cases or GIFs.
        try:
            # Simple insertion attempt with fitz directly
            page.insert_image(signature_rect, filename=signature_path)
        except Exception as img_err:
            # Fallback using Pillow (might handle some edge cases better)
            try:
                img = Image.open(signature_path)
                # Ensure RGBA for potential transparency handling if needed, though insert_image often does this
                # img = img.convert("RGBA") # Uncomment if explicit conversion needed
                img_bytes = io.BytesIO()
                # Determine format for saving bytes based on original extension or desired format
                fmt = img.format or 'PNG' # Default to PNG if format unknown
                if fmt.upper() == 'JPEG': fmt = 'JPEG' # Pillow uses JPEG, not JPG
                elif fmt.upper() == 'GIF': fmt = 'PNG' # Convert GIF to PNG for better PDF embedding
                else: fmt = 'PNG' # Default safe format

                img.save(img_bytes, format=fmt)
                img_bytes.seek(0)
                page.insert_image(signature_rect, stream=img_bytes)
                img.close()
            except Exception as pillow_err:
                 app.logger.error(f"Fitz Error: {img_err}, Pillow Error: {pillow_err}")
                 abort(500, description="Failed to process or insert signature image.")


        # 7. Save Modified PDF to Memory Stream
        output_stream = io.BytesIO()
        # Use garbage collection & deflation for smaller file size
        doc.save(output_stream, garbage=4, deflate=True)
        doc.close() # Close the document
        output_stream.seek(0) # Rewind the stream to the beginning

        # 8. Send the Signed PDF as a Download
        return send_file(
            output_stream,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='signed_document.pdf'
        )

    except Exception as e:
        # Log the full error for debugging
        app.logger.error(f"An error occurred: {e}", exc_info=True)
        # If it's a known client error (4xx), re-raise it
        if hasattr(e, 'code') and 400 <= e.code < 500:
             abort(e.code, description=e.description)
        # Otherwise, return a generic 500 error
        abort(500, description="An internal server error occurred during signing.")

    finally:
        # 9. Cleanup Temporary Files
        if pdf_path and os.path.exists(pdf_path):
            try:
                os.remove(pdf_path)
            except OSError as e:
                 app.logger.error(f"Error removing temp PDF file {pdf_path}: {e}")
        if signature_path and os.path.exists(signature_path):
            try:
                os.remove(signature_path)
            except OSError as e:
                 app.logger.error(f"Error removing temp signature file {signature_path}: {e}")


# --- Error Handler ---
@app.errorhandler(400)
@app.errorhandler(404) # Optional: Handle 404 if needed
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


# --- Main Execution ---
if __name__ == '__main__':
    ensure_upload_folder() # Ensure folder exists at startup
    app.run(debug=True) # debug=True for development, set to False for production