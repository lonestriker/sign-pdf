# PDF Signature Tool

A versatile PDF signature application that allows users to add signatures to PDF documents. The project supports both a Python-based backend solution and a pure browser-based implementation for maximum flexibility.

## Features

- Add signatures to PDF documents
- Two implementation options:
  - Browser-based solution (no server required)
  - Python backend solution
- Signatures are loaded as image files; Python version can convert images to remove background and make background transparent.
- Position signatures anywhere on PDF pages
- Preview PDF documents before signing
- Download signed PDFs instantly

## Browser-Based Version

The browser-based version runs entirely in your web browser, with no server requirements:

- Uses pure JavaScript/HTML5 for PDF manipulation
- Processes files locally in the browser
- Ensures privacy as files never leave your device
- Works offline after initial page load

### Usage (Browser Version)

Note that the signature converter is not be available in this web-only mode.

1. Clone the repository:
   ```bash
   git clone https://github.com/lonestriker/sign-pdf.git
   ```
2. Open broswer and load file directly from filesystem `file:///path/to/.../web/index.html`
3. Alternatively, if running on a remote linux server, run a Python web server with `cd sign-pdf; python -m http.server` and open `http://localhost:8000/` from your desktop.
4. Upload your PDF document
5. Draw your signature or upload a signature image
6. Position the signature on the PDF
7. Download the signed document

## Python Backend Version

The Python backend version offers additional features and processing capabilities:

### Prerequisites

- Python 3.9 or higher

### Usage (Python Version)

Python-based version allows conversion of signatures from images (jpg, gif, png, etc.) into transparent `png` format with a transparent background.

1. Clone the repository:
   ```bash
   git clone https://github.com/lonestriker/sign-pdf.git
   cd sign-pdf
   ```

2. Install dependencies for Python-based server (including signature converter):
   * Using [uv](https://docs.astral.sh/uv/getting-started/installation/) (recommended)
    ```bash
    uv sync
    ```

   * Using standard Python venv
    ```bash
    python -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    ```

3. Run the server:
   ```bash
   source .venv/bin/activate
   python app.py
   ```

4. Open your browser and navigate to `http://localhost:5000`


## Security Considerations

- Browser version: All processing happens locally, ensuring document privacy
- Python version: Files are temporarily stored on the server during processing
- No signatures or documents are permanently stored
- SSL recommended for production deployment of Python version

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- PDF.js for browser-based PDF rendering
- PyPDF2 for Python PDF processing

## Support

For issues, questions, or contributions, please open an issue in the GitHub repository.
