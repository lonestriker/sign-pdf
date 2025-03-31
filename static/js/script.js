// --- Import PDF.js Library ---
// Use a relative path assuming pdf.mjs is in the same /static/js/ directory
import * as pdfjsLib from './pdf.mjs';

// --- Set Worker Source ---
// Set this *after* importing, using a relative path to the worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';


// --- Globals (remain the same) ---
const pdfFileInput = document.getElementById('pdf-upload');
const sigFileInput = document.getElementById('signature-upload');
const viewerContainer = document.getElementById('viewer');
const signatureImage = document.getElementById('signatureImage');
const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const pageNumSpan = document.getElementById('page-num');
const pageCountSpan = document.getElementById('page-count');
const signButton = document.getElementById('sign-button');
const statusDiv = document.getElementById('status');

let pdfDoc = null;
let currentPageNum = 1;
let currentScale = 1.5; // Initial zoom level
let pdfFile = null; // Store the File object for upload
let signatureFile = null; // Store the File object for upload
let isDragging = false;
let startX, startY, initialLeft, initialTop;
let renderedPageWidth = 0; // Store rendered dimensions for coordinate mapping
let renderedPageHeight = 0;
let currentCanvas = null; // Reference to the current canvas


// --- Event Listeners (remain the same) ---
pdfFileInput.addEventListener('change', handlePdfUpload);
sigFileInput.addEventListener('change', handleSignatureUpload);
prevPageButton.addEventListener('click', goToPrevPage);
nextPageButton.addEventListener('click', goToNextPage);
signButton.addEventListener('click', placeAndSignPdf);

signatureImage.addEventListener('mousedown', startDrag);
document.addEventListener('mousemove', drag); // Listen on document for wider drag area
document.addEventListener('mouseup', endDrag);
signatureImage.addEventListener('dragstart', (e) => e.preventDefault()); // Prevent native image drag


// --- Functions (remain the same - pdfjsLib is now the imported object) ---

function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        pdfFile = file; // Store for later upload
        const reader = new FileReader();
        reader.onload = function(e) {
            setStatus('Loading PDF...', 'loading');
            // Use the imported pdfjsLib
            const loadingTask = pdfjsLib.getDocument({ data: e.target.result });
            loadingTask.promise.then(doc => {
                pdfDoc = doc;
                pageCountSpan.textContent = pdfDoc.numPages;
                currentPageNum = 1;
                renderPage(currentPageNum);
                updatePageControls();
                setStatus('PDF loaded. Upload signature.', 'success');
                checkEnableSignButton();
            }).catch(err => {
                console.error("Error loading PDF:", err);
                setStatus(`Error loading PDF: ${err.message}`, 'error');
                resetPdfState();
            });
        };
        reader.readAsArrayBuffer(file);
    } else {
        setStatus('Please select a valid PDF file.', 'error');
        resetPdfState();
        pdfFile = null;
    }
}

function handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        signatureFile = file; // Store for later upload
        const reader = new FileReader();
        reader.onload = function(e) {
            signatureImage.src = e.target.result;
            signatureImage.style.display = 'block'; // Make it visible
             // Reset position on new signature upload
            signatureImage.style.left = '10px';
            signatureImage.style.top = '10px';
            setStatus('Signature loaded. Place it on the PDF.', 'success');
            checkEnableSignButton();
        }
        reader.readAsDataURL(file);
    } else {
        setStatus('Please select a valid image file (PNG, JPG, GIF).', 'error');
        resetSignatureState();
        signatureFile = null;
    }
}

function renderPage(num) {
    if (!pdfDoc) return;
    setStatus('Rendering page...', 'loading');
    pdfDoc.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Store rendered dimensions *before* adding to DOM (more reliable)
        renderedPageWidth = viewport.width;
        renderedPageHeight = viewport.height;

        // Clear previous canvas and append new one
        viewerContainer.innerHTML = ''; // Clear previous content
        viewerContainer.appendChild(canvas);
        viewerContainer.appendChild(signatureImage); // Re-append signature image if loaded
        currentCanvas = canvas; // Update reference

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        const renderTask = page.render(renderContext);
        renderTask.promise.then(() => {
            pageNumSpan.textContent = num;
            setStatus('Page rendered. Drag signature if needed.', 'success');
        }).catch(err => {
             console.error("Error rendering page:", err);
             setStatus(`Error rendering page ${num}: ${err.message}`, 'error');
        });
    }).catch(err => {
         console.error("Error getting page:", err);
         setStatus(`Error getting page ${num}: ${err.message}`, 'error');
    });
}

function updatePageControls() {
    if (!pdfDoc) return;
    prevPageButton.disabled = (currentPageNum <= 1);
    nextPageButton.disabled = (currentPageNum >= pdfDoc.numPages);
}

function goToPrevPage() {
    if (currentPageNum <= 1) return;
    currentPageNum--;
    renderPage(currentPageNum);
    updatePageControls();
}

function goToNextPage() {
    if (!pdfDoc || currentPageNum >= pdfDoc.numPages) return;
    currentPageNum++;
    renderPage(currentPageNum);
    updatePageControls();
}

function checkEnableSignButton() {
    signButton.disabled = !(pdfFile && signatureFile && pdfDoc);
}

function resetPdfState() {
     pdfDoc = null;
     currentPageNum = 1;
     pageNumSpan.textContent = '0';
     pageCountSpan.textContent = '0';
     viewerContainer.innerHTML = ''; // Clear canvas
     viewerContainer.appendChild(signatureImage); // Keep signature if loaded
     updatePageControls();
     checkEnableSignButton();
     renderedPageWidth = 0;
     renderedPageHeight = 0;
     currentCanvas = null;
}

function resetSignatureState() {
    signatureImage.src = '#';
    signatureImage.style.display = 'none';
    checkEnableSignButton();
}

function setStatus(message, type = 'info') { // types: info, loading, error, success
    statusDiv.textContent = message;
    statusDiv.className = type; // Use class for styling
}

// --- Drag and Drop Logic (remains the same) ---
function startDrag(e) {
    // Prevent drag if signature not loaded or pdf not ready
    if (!signatureFile || !pdfDoc || !currentCanvas) return;

    isDragging = true;
    signatureImage.style.cursor = 'grabbing';

    // Get coordinates relative to the viewport
    startX = e.clientX;
    startY = e.clientY;

    // Get initial position relative to the parent (#viewer)
    initialLeft = signatureImage.offsetLeft;
    initialTop = signatureImage.offsetTop;

    // Prevent text selection while dragging
    document.body.style.userSelect = 'none';
}

function drag(e) {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

     // --- Boundary checks (relative to viewer) ---
    const viewerRect = viewerContainer.getBoundingClientRect(); // Get viewer bounds
    const sigRect = signatureImage.getBoundingClientRect(); // Get signature size

    // Ensure left edge is within bounds
    if (newLeft < 0) newLeft = 0;
    // Ensure top edge is within bounds
    if (newTop < 0) newTop = 0;
     // Ensure right edge is within bounds
    if (newLeft + sigRect.width > viewerRect.width) {
        newLeft = viewerRect.width - sigRect.width;
    }
    // Ensure bottom edge is within bounds
    if (newTop + sigRect.height > viewerRect.height) {
         newTop = viewerRect.height - sigRect.height;
    }
     // Handle cases where signature might be larger than viewer
    if (sigRect.width >= viewerRect.width) newLeft = 0;
    if (sigRect.height >= viewerRect.height) newTop = 0;
    // --- End boundary checks ---


    signatureImage.style.left = `${newLeft}px`;
    signatureImage.style.top = `${newTop}px`;
}


function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    signatureImage.style.cursor = 'move';
    document.body.style.userSelect = ''; // Re-enable text selection
    // Final position is now set via inline style
}

// --- Signing Process (remains the same) ---
function placeAndSignPdf() {
    if (!pdfFile || !signatureFile || !pdfDoc || !currentCanvas) {
        setStatus('Please load PDF and signature first.', 'error');
        return;
    }

    setStatus('Processing...', 'loading');
    signButton.disabled = true; // Prevent multiple clicks

    const formData = new FormData();
    formData.append('pdfFile', pdfFile);
    formData.append('signatureFile', signatureFile);

    // --- Crucial: Get coordinates and dimensions for backend ---
    // Coordinates are relative to the top-left of the VIEWER div (which contains the canvas)
    const sigX = signatureImage.offsetLeft;
    const sigY = signatureImage.offsetTop;

    // Get the RENDERED dimensions of the signature image as displayed
    const sigWidthPx = signatureImage.offsetWidth;
    const sigHeightPx = signatureImage.offsetHeight;

    // Get the RENDERED dimensions of the currently displayed page (canvas)
    const pageWidthPx = renderedPageWidth; // Use stored value
    const pageHeightPx = renderedPageHeight; // Use stored value

    // Append metadata
    formData.append('pageNum', currentPageNum - 1); // Send 0-based index
    formData.append('x', sigX);
    formData.append('y', sigY);
    formData.append('signatureWidthPx', sigWidthPx);
    formData.append('signatureHeightPx', sigHeightPx);
    formData.append('pageWidthPx', pageWidthPx);
    formData.append('pageHeightPx', pageHeightPx);

    // --- Send to Backend ---
    fetch('/sign', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
             // Try to parse JSON error body from Flask
            return response.json().then(errData => {
                throw new Error(errData.error?.message || `HTTP error! Status: ${response.status}`);
            }).catch(parseErr => {
                 // If parsing JSON fails, use the status text
                 throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`);
            });
        }
        // Expecting a blob (the PDF file)
        return response.blob();
    })
    .then(blob => {
        setStatus('Signed PDF ready for download.', 'success');
        // Create a download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'signed_document.pdf'; // Filename for the download
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url); // Clean up
        document.body.removeChild(a);
        signButton.disabled = false; // Re-enable button
    })
    .catch(error => {
        console.error('Signing error:', error);
        setStatus(`Signing failed: ${error.message}`, 'error');
        signButton.disabled = false; // Re-enable button
    });
}