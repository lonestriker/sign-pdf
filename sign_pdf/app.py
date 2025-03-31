import os
import io
import uuid
import argparse # Keep argparse import
from flask import Flask, render_template, request, send_file, jsonify, abort
from PIL import Image

# --- Configuration ---
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS_IMG = {'png', 'jpg', 'jpeg', 'gif'}
BACKGROUND_REMOVAL_TOLERANCE = 30

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# --- Helper Functions ---
def allowed_file(filename, allowed_set):
    """Checks if the file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in allowed_set

def ensure_upload_folder():
    """Creates the upload folder if it doesn't exist."""
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        try:
            os.makedirs(app.config['UPLOAD_FOLDER'])
            app.logger.info(f"Created upload folder: {app.config['UPLOAD_FOLDER']}")
        except OSError as e:
            app.logger.error(f"Could not create upload folder: {e}")

def remove_background(image_bytes, tolerance=BACKGROUND_REMOVAL_TOLERANCE):
    """Removes the background from image bytes, returns PNG bytes."""
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        if img.mode == 'P': img = img.convert("RGBA") # Handle palette mode

        try:
             bg_pixel = img.getpixel((0, 0))
        except IndexError:
             bg_pixel = (255, 255, 255, 255)
             app.logger.warning("Could not get corner pixel, assuming white background.")

        newData = []
        for item in img.getdata():
            is_background = True
            if len(item) >= 3 and len(bg_pixel) >= 3:
                if not all(bg_pixel[i] - tolerance <= item[i] <= bg_pixel[i] + tolerance for i in range(3)):
                    is_background = False
            elif len(item) >= 1 and len(bg_pixel) >= 1: # Grayscale check
                 if not (bg_pixel[0] - tolerance <= item[0] <= bg_pixel[0] + tolerance):
                     is_background = False
            else:
                is_background = False

            if len(item) > 3 and item[3] < 20:
                 is_background = True

            newData.append((255, 255, 255, 0) if is_background else item)

        img.putdata(newData)
        output_buffer = io.BytesIO()
        img.save(output_buffer, format="PNG")
        img.close()
        output_buffer.seek(0)
        return output_buffer.getvalue()

    except Exception as e:
        app.logger.error(f"Error removing background: {e}", exc_info=True)
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
        return send_file(
            io.BytesIO(processed_bytes),
            mimetype='image/png',
            as_attachment=True,
            download_name=f"{os.path.splitext(sig_file.filename)[0]}_transparent.png"
        )
    except ValueError as e:
         app.logger.error(f"Conversion processing error: {e}")
         abort(400, description=str(e))
    except Exception as e:
        app.logger.error(f"Unexpected conversion error: {e}", exc_info=True)
        abort(500, description="Server error during image processing.")

# --- Error Handler ---
@app.errorhandler(400)
@app.errorhandler(404)
@app.errorhandler(500)
def handle_error(error):
    """Generic JSON error handler."""
    response = jsonify({ 'error': { 'type': error.name if hasattr(error, 'name') else 'Error', 'message': getattr(error, 'description', 'An error occurred.') } })
    response.status_code = getattr(error, 'code', 500)
    return response

# --- Application Runner / CLI Function ---
def run_app():
    """Parses arguments and runs the Flask application."""
    parser = argparse.ArgumentParser(description='Run the Flask Signature App.')
    parser.add_argument(
        '--host',
        type=str,
        default='0.0.0.0', # Default host
        help='The interface to bind the server to. Default: 0.0.0.0'
    )
    parser.add_argument(
        '--port',
        type=int,
        default=5000,      # Default port
        help='The port number for the server to listen on. Default: 5000'
    )
    parser.add_argument(
        '--debug',
        action='store_true', # Use store_true for boolean flags
        help='Enable Flask debug mode.'
    )

    args = parser.parse_args()

    # ensure_upload_folder() # Optional: Call if needed before app starts

    print(f" * Starting Flask server on http://{args.host}:{args.port}")
    if args.debug:
        print(" * Debug mode is ON")
    # Pass debug value to app.run
    app.run(host=args.host, port=args.port, debug=args.debug)

# --- Main Execution Guard ---
if __name__ == '__main__':
    run_app() # Call the argument parsing and app runner function