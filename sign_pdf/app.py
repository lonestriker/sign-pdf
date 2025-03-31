import os
import io
import uuid
# No longer need json here unless used elsewhere
from flask import Flask, render_template, request, send_file, jsonify, abort
# No longer need fitz (PyMuPDF) for signing
from PIL import Image # Still needed for background removal

# --- Configuration ---
UPLOAD_FOLDER = 'uploads' # Still potentially needed for /convert_signature temporary storage if desired, or can process in memory
ALLOWED_EXTENSIONS_IMG = {'png', 'jpg', 'jpeg', 'gif'}
# ALLOWED_EXTENSIONS_PDF = {'pdf'} # Not needed if /sign is removed
BACKGROUND_REMOVAL_TOLERANCE = 30 # Config for background removal

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 # Reduced slightly as only images are uploaded now

# --- Helper Functions ---
def allowed_file(filename, allowed_set):
    """Checks if the file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in allowed_set

def ensure_upload_folder():
    """Creates the upload folder if it doesn't exist."""
    # Might not be strictly necessary if /convert_signature processes in memory
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        try:
            os.makedirs(app.config['UPLOAD_FOLDER'])
            app.logger.info(f"Created upload folder: {app.config['UPLOAD_FOLDER']}")
        except OSError as e:
            app.logger.error(f"Could not create upload folder: {e}")
            # Decide if this is fatal or if in-memory processing is okay

def remove_background(image_bytes, tolerance=BACKGROUND_REMOVAL_TOLERANCE):
    """Removes the background from image bytes, returns PNG bytes."""
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        if img.mode == 'P': img = img.convert("RGBA") # Handle palette mode

        # Try getting corner pixel, fallback if needed (e.g., fully transparent image)
        try:
             bg_pixel = img.getpixel((0, 0))
        except IndexError:
             # Fallback: assume white background if corner pixel access fails
             bg_pixel = (255, 255, 255, 255)
             app.logger.warning("Could not get corner pixel, assuming white background.")

        newData = []
        for item in img.getdata():
            is_background = True
            # Compare RGB within tolerance (check lengths first)
            if len(item) >= 3 and len(bg_pixel) >= 3:
                if not all(bg_pixel[i] - tolerance <= item[i] <= bg_pixel[i] + tolerance for i in range(3)):
                    is_background = False
            elif len(item) >= 1 and len(bg_pixel) >= 1: # Grayscale check
                 if not (bg_pixel[0] - tolerance <= item[0] <= bg_pixel[0] + tolerance):
                     is_background = False
            else: # Cannot determine color similarity
                is_background = False

            # Alpha check (treat highly transparent pixels as background)
            if len(item) > 3 and item[3] < 20:
                 is_background = True

            newData.append((255, 255, 255, 0) if is_background else item)

        img.putdata(newData)
        output_buffer = io.BytesIO()
        img.save(output_buffer, format="PNG") # Always save as PNG
        img.close()
        output_buffer.seek(0)
        return output_buffer.getvalue()

    except Exception as e:
        app.logger.error(f"Error removing background: {e}", exc_info=True)
        # Re-raise a more specific error for the route handler
        raise ValueError(f"Failed to process image background: {e}")


# --- Routes ---
@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

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
        processed_bytes = remove_background(image_bytes)

        # Send back the processed PNG data
        return send_file(
            io.BytesIO(processed_bytes),
            mimetype='image/png',
            as_attachment=True, # Suggest download
            download_name=f"{os.path.splitext(sig_file.filename)[0]}_transparent.png" # Generate download name
        )
    except ValueError as e: # Catch specific error from remove_background
         app.logger.error(f"Conversion processing error: {e}")
         abort(400, description=str(e))
    except Exception as e:
        app.logger.error(f"Unexpected conversion error: {e}", exc_info=True)
        abort(500, description="Server error during image processing.")


# --- REMOVED /sign ROUTE ---
# @app.route('/sign', methods=['POST'])
# def sign_pdf():
#    ... (All the previous /sign logic is removed) ...


# --- Error Handler ---
@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(500)
def handle_error(error):
    """Generic JSON error handler."""
    response = jsonify({ 'error': { 'type': error.name if hasattr(error, 'name') else 'Error', 'message': getattr(error, 'description', 'An error occurred.') } })
    response.status_code = getattr(error, 'code', 500)
    return response

# --- Main Execution ---
def main():
    # ensure_upload_folder() # May not be needed if processing in memory
    app.run(debug=True) # Add host='0.0.0.0' if needed for network access

if __name__ == '__main__':
    main()