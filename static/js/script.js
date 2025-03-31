// Access libraries loaded globally via script tags in HTML
const { PDFDocument, rgb, StandardFonts } = PDFLib; // Destructure from pdf-lib global
const SignaturePad = window.SignaturePad; // Access from global scope
// pdfjsLib should be available globally from the module script in HTML

// --- Globals (DOM Elements) ---
const pdfFileInput = document.getElementById('pdf-upload');
const sigFileInput = document.getElementById('signature-upload');
const signatureGallery = document.getElementById('signature-gallery');
const viewerContainer = document.getElementById('viewer');
const signatureBox = document.getElementById('signatureBox'); // ACTIVE placement box
const signatureImage = document.getElementById('signatureImage'); // Image in the ACTIVE box
const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const pageNumSpan = document.getElementById('page-num');
const pageCountSpan = document.getElementById('page-count');
const addSigButton = document.getElementById('add-signature-btn');
const generateButton = document.getElementById('generate-button');
const statusDiv = document.getElementById('status');
const placedSignaturesList = document.getElementById('placed-signatures-list');
// NEW: Elements for signature input toggle and drawing modal
const sigUploadArea = document.getElementById('signature-upload-area');
const sigDrawArea = document.getElementById('signature-draw-area');
const showUploadBtn = document.getElementById('show-upload-btn');
const showDrawBtn = document.getElementById('show-draw-btn');
const openDrawModalBtn = document.getElementById('open-draw-modal-btn');
const signatureModal = document.getElementById('signature-modal');
const signaturePadCanvas = document.getElementById('signature-pad-canvas');
const clearSignatureBtn = document.getElementById('clear-signature-btn');
const saveSignatureBtn = document.getElementById('save-signature-btn');
const closeSignatureModalBtn = document.getElementById('close-signature-modal-btn');


// --- State Variables ---
let pdfDocProxy = null; // PDF.js document proxy for rendering
let currentPageNum = 1;
let currentScale = 1.5;
let pdfFile = null; // The original PDF File object

let uploadedSignatures = []; // { id, file, dataUrl, name } <- Added name
let activeSignatureId = null;
let placedSignatures = []; // { placementId, signatureId, pageNum (0-based), x, y, widthPx, heightPx }

// Interaction state
let isDragging = false;
let isResizing = false;
let resizeHandle = null;
let startX, startY, initialLeft, initialTop, initialWidth, initialHeight;

// Rendered page dimensions (critical for scaling)
let renderedPageWidth = 0;
let renderedPageHeight = 0;
let currentCanvas = null;

// NEW: Signature Pad instance
let signaturePad = null;

// Tailwind classes for status messages
const STATUS_CLASSES = {
    info: 'text-blue-600',
    loading: 'text-gray-600 animate-pulse',
    error: 'text-red-600 font-semibold',
    success: 'text-green-600'
};

// NEW: Define upscale factor for signature pad resolution
const SIGNATURE_PAD_UPSCALE_FACTOR = 2.5; // Try 2, 2.5, or 3

// --- Initialization ---
setupSignatureInputToggle(); // Setup the toggle UI first
updateButtonStates();
checkSignaturePadLib(); // Check if library loaded

// --- Event Listeners ---
pdfFileInput.addEventListener('change', handlePdfUpload);
sigFileInput.addEventListener('change', handleSignatureUpload);
signatureGallery.addEventListener('click', handleGalleryClick);
prevPageButton.addEventListener('click', goToPrevPage);
nextPageButton.addEventListener('click', goToNextPage);
signatureBox.addEventListener('mousedown', startDragOrResize);
document.addEventListener('mousemove', handleMouseMove);
document.addEventListener('mouseup', handleMouseUp);
signatureImage.addEventListener('dragstart', (e) => e.preventDefault());
addSigButton.addEventListener('click', addPlacement);
generateButton.addEventListener('click', generateSignedPdfClientSide);
placedSignaturesList.addEventListener('click', handleRemovePlacement);

// NEW: Listeners for signature pad
showUploadBtn.addEventListener('click', showUploadMode);
showDrawBtn.addEventListener('click', showDrawMode);
openDrawModalBtn.addEventListener('click', openSignatureModal);
closeSignatureModalBtn.addEventListener('click', closeSignatureModal);
clearSignatureBtn.addEventListener('click', () => { if (signaturePad) signaturePad.clear(); });
saveSignatureBtn.addEventListener('click', saveDrawnSignature);
window.addEventListener('resize', resizeCanvas); // Resize signature pad canvas if window changes


// --- Library Check ---
function checkSignaturePadLib() {
    if (typeof SignaturePad === 'undefined') {
        console.error("SignaturePad library not loaded!");
        setStatus("Error: Signature drawing library failed to load. Drawing disabled.", "error");
        // Disable draw functionality if library missing
        if (showDrawBtn) showDrawBtn.disabled = true;
        if (openDrawModalBtn) openDrawModalBtn.disabled = true;
    }
}

// --- Signature Input Mode Toggle ---

/** Sets up the toggle between Upload File and Draw Signature modes. */
function setupSignatureInputToggle() {
    showUploadMode(); // Default to upload mode
}

/** Shows the file upload input and hides the draw button. */
function showUploadMode() {
    if (!sigUploadArea || !sigDrawArea || !showUploadBtn || !showDrawBtn) return;
    sigUploadArea.classList.remove('hidden');
    sigDrawArea.classList.add('hidden');
    showUploadBtn.classList.add('active');
    showDrawBtn.classList.remove('active');
}

/** Shows the draw button and hides the file upload input. */
function showDrawMode() {
    if (!sigUploadArea || !sigDrawArea || !showUploadBtn || !showDrawBtn) return;
    sigUploadArea.classList.add('hidden');
    sigDrawArea.classList.remove('hidden');
    showDrawBtn.classList.add('active');
    showUploadBtn.classList.remove('active');
}

// --- Signature Pad Modal ---

/** Opens the signature drawing modal. */
function openSignatureModal() {
    if (!signatureModal) return;
    signatureModal.classList.remove('hidden');
    signatureModal.classList.add('flex'); // Use flex to center content
    initializeSignaturePad();
}

/** Closes the signature drawing modal. */
function closeSignatureModal() {
    if (!signatureModal) return;
    signatureModal.classList.add('hidden');
    signatureModal.classList.remove('flex');
    if (signaturePad) {
        signaturePad.off(); // Clean up listeners to prevent memory leaks
    }
}

/** Initializes or reinitializes the SignaturePad instance. */
function initializeSignaturePad() {
    if (!signaturePadCanvas || typeof SignaturePad === 'undefined') {
        console.error("Signature pad canvas or library not available.");
        setStatus("Cannot initialize signature pad.", "error");
        closeSignatureModal();
        return;
    }
    // Ensure canvas has explicit dimensions needed by SignaturePad
    if (!signaturePadCanvas.width || !signaturePadCanvas.height) {
        console.warn("Canvas needs explicit width/height attributes. Setting defaults.");
        const style = getComputedStyle(signaturePadCanvas);
        signaturePadCanvas.width = parseInt(style.width, 10) || 480;
        signaturePadCanvas.height = parseInt(style.height, 10) || 192;
    }

    resizeCanvas(); // Adjust for device pixel ratio

    if (signaturePad) {
        signaturePad.off(); // Remove old listeners
        signaturePad.clear();
    }
    signaturePad = new SignaturePad(signaturePadCanvas, {
         backgroundColor: 'rgb(255, 255, 255)', // White background
         penColor: 'rgb(0, 0, 0)'           // Black ink
    });
    signaturePad.clear(); // Start with a clear pad
}

/** Resizes the signature pad canvas based on its display size, pixel ratio, and upscale factor. */
function resizeCanvas() {
    if (!signaturePadCanvas || !signaturePadCanvas.offsetParent) {
        // Don't resize if the canvas isn't visible (e.g., modal closed)
        return;
    }
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    // Calculate the desired internal pixel dimensions
    const displayWidth = signaturePadCanvas.offsetWidth;
    const displayHeight = signaturePadCanvas.offsetHeight;
    const internalWidth = displayWidth * ratio * SIGNATURE_PAD_UPSCALE_FACTOR;
    const internalHeight = displayHeight * ratio * SIGNATURE_PAD_UPSCALE_FACTOR;

    // Check if dimensions actually changed to avoid unnecessary clearing
    if (signaturePadCanvas.width !== internalWidth || signaturePadCanvas.height !== internalHeight) {

        // Set internal buffer size based on display size * ratio * upscaleFactor
        signaturePadCanvas.width = internalWidth;
        signaturePadCanvas.height = internalHeight;

        const ctx = signaturePadCanvas.getContext("2d");
        if (ctx) {
            // Scale the drawing context to match the upscaled resolution
            ctx.scale(ratio * SIGNATURE_PAD_UPSCALE_FACTOR, ratio * SIGNATURE_PAD_UPSCALE_FACTOR);

            if (signaturePad) {
                 // Data caches need to be cleared after canvas buffer size changes
                 signaturePad.clear();
                 // You might potentially lose existing drawing here if the modal was
                 // resized while open. Usually called when modal opens, so it's fine.
            }
            console.log(`Signature pad resized to internal: ${internalWidth}x${internalHeight} (display: ${displayWidth}x${displayHeight})`);
        } else {
            console.error("Failed to get 2D context for signature pad canvas.");
        }
    }
}

// --- Signature Processing & Saving (Drawn) ---

/** Helper to convert a Base64 Data URL to a File object. */
function dataURLtoFile(dataurl, filename) {
    try {
        let arr = dataurl.split(','), mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) throw new Error("Invalid Data URL format");
        let mime = mimeMatch[1], bstr = atob(arr[arr.length - 1]), n = bstr.length, u8arr = new Uint8Array(n);
        while(n--){ u8arr[n] = bstr.charCodeAt(n); }
        return new File([u8arr], filename, {type:mime});
    } catch (e) {
        console.error("Error converting Data URL to File:", e);
        setStatus("Error processing drawn signature.", "error");
        return null;
    }
}

/**
 * Processes a signature image Data URL to make near-white pixels transparent
 * and all other pixels SOLID BLACK and OPAQUE using Canvas.
 * @param {string} dataUrl - The original Data URL (likely with white background).
 * @returns {Promise<string>} A Promise resolving with the new Data URL (PNG format).
 */
function makeBackgroundTransparent(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth; // Use natural dimensions
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) { throw new Error("Failed to get 2D context."); }

                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                const whiteThreshold = 250; // Pixels with R, G, and B all >= this value become transparent

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];

                    // Check if the pixel is 'white enough'
                    if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
                        data[i + 3] = 0; // Make transparent
                    } else { // It's part of the signature (or anti-aliasing)
                        data[i] = 0;     // Force Black
                        data[i + 1] = 0;
                        data[i + 2] = 0;
                        data[i + 3] = 255; // Make Opaque
                    }
                }
                ctx.putImageData(imageData, 0, 0);
                resolve(canvas.toDataURL('image/png')); // Always return PNG for transparency
            } catch (error) {
                 console.error("Transparency processing error:", error);
                 reject(new Error("Failed to process signature transparency."));
            }
        };
        img.onerror = (error) => {
            console.error("Image load error for transparency:", error);
            reject(new Error("Failed to load signature image for processing."));
        };
        img.src = dataUrl;
    });
}


/** Saves the signature drawn on the pad, makes background transparent, adds to gallery. */
async function saveDrawnSignature() {
    if (!signaturePad || signaturePad.isEmpty()) {
        alert("Please provide a signature first.");
        return;
    }
    setStatus('Processing drawn signature...', 'loading');
    try {
        // Get original signature as PNG
        const originalDataURL = signaturePad.toDataURL('image/png');

        // Process it to have black ink and transparent background
        const transparentDataURL = await makeBackgroundTransparent(originalDataURL);

        // Create a File object from the processed data URL
        const timestamp = Date.now();
        const filename = `signature_${timestamp}.png`; // Use PNG extension
        const signatureFileObject = dataURLtoFile(transparentDataURL, filename);

        if (!signatureFileObject) {
             // Error handled within dataURLtoFile, status already set
             return;
        }

        // Add to the uploadedSignatures array (using the same structure as file uploads)
        const signatureData = {
            id: `sig_${timestamp}_${Math.random().toString(16).slice(2)}`,
            file: signatureFileObject, // The processed PNG File object
            dataUrl: transparentDataURL, // The processed data URL for preview
            name: filename // Store the generated name
        };
        uploadedSignatures.push(signatureData);

        renderSignatureGallery(); // Update the UI gallery
        setActiveSignature(signatureData.id); // Select the new signature

        setStatus('Drawn signature saved and selected.', 'success');
        closeSignatureModal(); // Close the modal on success

    } catch (error) {
        console.error("Error saving drawn signature:", error);
        setStatus(`Error saving drawn signature: ${error.message || error}`, "error");
    }
}


// --- PDF Loading & Rendering (using PDF.js) ---

function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        pdfFile = file; // Store the File object
        const reader = new FileReader();
        reader.onload = function(e) {
            setStatus('Loading PDF...', 'loading');
            // Ensure pdfjsLib is available (loaded via module script)
            if (!window.pdfjsLib) {
                setStatus("Error: PDF rendering library not loaded.", "error");
                console.error("pdfjsLib is not defined globally.");
                return;
            }
            const loadingTask = window.pdfjsLib.getDocument({ data: e.target.result });
            loadingTask.promise.then(doc => {
                pdfDocProxy = doc; // Store the PDF.js document proxy
                pageCountSpan.textContent = pdfDocProxy.numPages;
                currentPageNum = 1;
                placedSignatures = [];
                renderPlacedSignaturesList();
                clearPersistentPlacements();
                renderPage(currentPageNum); // Initial render
                setStatus('PDF loaded. Add or draw signature(s).', 'success'); // Updated text
            }).catch(err => {
                console.error("Error loading PDF:", err);
                setStatus(`Error loading PDF: ${err.message || err}`, 'error');
                resetPdfState();
            });
        };
        reader.readAsArrayBuffer(file); // Read as ArrayBuffer for PDF.js
    } else {
        setStatus('Please select a valid PDF file.', 'error');
        resetPdfState();
        pdfFile = null;
    }
    updateButtonStates();
}

function renderPage(num) {
    if (!pdfDocProxy) return;
    setStatus('Rendering page...', 'loading');
    signatureBox.classList.add('hidden');
    clearPersistentPlacements(); // Clear old visual divs

    pdfDocProxy.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
            handleRenderError(new Error("Failed to get 2D context for PDF page"), num);
            return;
        }
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = "block mx-auto shadow-md"; // Style the canvas

        // Store dimensions for placement calculations
        renderedPageWidth = viewport.width;
        renderedPageHeight = viewport.height;

        // Replace previous canvas if exists
        const existingCanvas = viewerContainer.querySelector('canvas');
        if (existingCanvas) existingCanvas.remove();
        // Insert canvas before the active signature box
        viewerContainer.insertBefore(canvas, signatureBox);
        currentCanvas = canvas; // Update current canvas reference

        const renderContext = { canvasContext: context, viewport: viewport };
        page.render(renderContext).promise.then(() => {
            pageNumSpan.textContent = num; // Update page number display
            setStatus('Page rendered. Place signature.', 'success');
            updatePageControls(); // Update prev/next button states
            renderPersistentPlacementsForPage(num - 1); // Re-render persistent signatures for this page
            if (activeSignatureId) {
                signatureBox.classList.remove('hidden'); // Show active box if a signature is selected
                keepSignatureInBounds(signatureBox); // Ensure it's within bounds initially
            }
        }).catch(err => handleRenderError(err, num));
    }).catch(err => handleRenderError(err, num));
}

// --- Signature Upload & Gallery (Uploaded Files) ---

function handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        // Basic check for PNG/JPG/GIF - pdf-lib primarily supports PNG/JPG embedding
        if (!['image/png', 'image/jpeg', 'image/gif'].includes(file.type)) {
             setStatus('Warning: Only PNG and JPG signatures are reliably embedded. GIF might not work.', 'info');
        }
        const reader = new FileReader();
        reader.onload = function(e) {
            const signatureData = {
                id: `sig_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                file: file, // Store the File object itself
                dataUrl: e.target.result, // For preview
                name: file.name // Store original file name
            };
            uploadedSignatures.push(signatureData);
            renderSignatureGallery();
            setActiveSignature(signatureData.id);
            setStatus('Signature uploaded. Select from gallery to place.', 'success');
        }
        reader.readAsDataURL(file);
        event.target.value = null; // Allow re-uploading same file
    } else {
        setStatus('Please select a valid image file (PNG, JPG, GIF).', 'error');
    }
    updateButtonStates();
}

// --- UI Interaction Functions ---

function renderSignatureGallery() {
    signatureGallery.innerHTML = '';
    if (uploadedSignatures.length === 0) {
         signatureGallery.innerHTML = '<span class="text-xs text-gray-500 italic">Signatures added via Upload or Draw will appear here.</span>';
         return;
    }
    uploadedSignatures.forEach(sig => {
        const img = document.createElement('img');
        img.src = sig.dataUrl; // Use the dataUrl for preview (works for both uploaded and drawn)
        img.alt = `Signature Preview: ${sig.name}`; // Use stored name
        img.title = sig.name; // Tooltip with full name
        img.dataset.signatureId = sig.id;
        img.className = `h-12 md:h-16 object-contain border-2 border-transparent rounded cursor-pointer hover:border-gray-400`;
        if (sig.id === activeSignatureId) {
            img.classList.add('active-signature'); // Highlight active one
        }
        signatureGallery.appendChild(img);
    });
}

function handleGalleryClick(event) {
    if (event.target.tagName === 'IMG' && event.target.dataset.signatureId) {
        setActiveSignature(event.target.dataset.signatureId);
    }
}

function setActiveSignature(signatureId) {
    activeSignatureId = signatureId;
    const activeSigData = uploadedSignatures.find(s => s.id === signatureId);
    if (activeSigData && signatureBox && signatureImage) {
        signatureImage.src = activeSigData.dataUrl;
        signatureBox.classList.remove('hidden');
        // Reset position/size for the newly activated signature
        signatureBox.style.left = '10px';
        signatureBox.style.top = '10px';
        signatureBox.style.width = '150px';
        signatureBox.style.height = 'auto'; // Let aspect ratio determine initial height
        // Adjust height based on image aspect ratio after it potentially loads/renders
        requestAnimationFrame(() => { // Defer calculation slightly
            const imgElement = signatureImage; // Direct reference
            const intrinsicWidth = imgElement.naturalWidth;
            const intrinsicHeight = imgElement.naturalHeight;
            const currentWidth = signatureBox.offsetWidth;

            if (intrinsicWidth > 0 && intrinsicHeight > 0) {
                const aspectRatio = intrinsicHeight / intrinsicWidth;
                const calculatedHeight = currentWidth * aspectRatio;
                signatureBox.style.height = `${Math.max(20, calculatedHeight)}px`; // Ensure min height
            } else {
                 // Fallback if image dimensions aren't available yet
                 signatureBox.style.height = '75px';
            }

            if (currentCanvas) keepSignatureInBounds(signatureBox); // Ensure it's within bounds
        });
    } else {
        // Deactivate if no valid signature found or elements missing
        activeSignatureId = null;
        if(signatureImage) signatureImage.src = '#';
        if(signatureBox) signatureBox.classList.add('hidden');
    }
    renderSignatureGallery(); // Update gallery highlight
    updateButtonStates();
}

function handleRenderError(err, pageNum) {
     console.error(`Error rendering page ${pageNum}:`, err);
     setStatus(`Error rendering page ${pageNum}: ${err.message || err}`, 'error');
     updatePageControls();
}

function renderPersistentPlacementsForPage(pageNumZeroBased) {
     // No change needed here, relies on placedSignatures array
     const placementsForPage = placedSignatures.filter(p => p.pageNum === pageNumZeroBased);
     placementsForPage.forEach(renderSinglePersistentPlacement);
}

function clearPersistentPlacements() {
     // No change needed here
     const persistentPlacements = viewerContainer.querySelectorAll('.persistent-placement');
     persistentPlacements.forEach(el => el.remove());
}

function updatePageControls() {
    // No change needed here
    if (!pdfDocProxy) return;
    prevPageButton.disabled = (currentPageNum <= 1);
    nextPageButton.disabled = (currentPageNum >= pdfDocProxy.numPages);
}

function goToPrevPage() {
    // No change needed here
    if (currentPageNum <= 1) return;
    currentPageNum--;
    renderPage(currentPageNum);
}

function goToNextPage() {
    // No change needed here
    if (!pdfDocProxy || currentPageNum >= pdfDocProxy.numPages) return;
    currentPageNum++;
    renderPage(currentPageNum);
}

function updateButtonStates() {
    // No change needed here
    addSigButton.disabled = !(pdfDocProxy && activeSignatureId && currentCanvas);
    generateButton.disabled = !(pdfDocProxy && placedSignatures.length > 0);
}

function resetPdfState() {
     // No change needed here
     pdfDocProxy = null;
     currentPageNum = 1;
     pageNumSpan.textContent = '0';
     pageCountSpan.textContent = '0';
     const existingCanvas = viewerContainer.querySelector('canvas');
     if (existingCanvas) existingCanvas.remove();
     clearPersistentPlacements();
     signatureBox.classList.add('hidden');
     updatePageControls();
     renderedPageWidth = 0;
     renderedPageHeight = 0;
     currentCanvas = null;
     pdfFile = null;
     placedSignatures = [];
     renderPlacedSignaturesList();
     // Reset signature state too
     // uploadedSignatures = []; // Keep signatures unless user explicitly clears? Optional.
     activeSignatureId = null;
     renderSignatureGallery(); // Reflect cleared active state
     updateButtonStates();
}

function setStatus(message, type = 'info') {
    // No change needed here
    statusDiv.textContent = message;
    Object.values(STATUS_CLASSES).forEach(cls => statusDiv.classList.remove(...cls.split(' ')));
    if (STATUS_CLASSES[type]) {
        statusDiv.classList.add(...STATUS_CLASSES[type].split(' '));
    }
}

// --- Drag and Resize Logic (Unchanged) ---

function startDragOrResize(e) {
    if (!activeSignatureId || !pdfDocProxy || !currentCanvas) return;
    startX = e.clientX; startY = e.clientY;
    initialLeft = signatureBox.offsetLeft; initialTop = signatureBox.offsetTop;
    initialWidth = signatureBox.offsetWidth; initialHeight = signatureBox.offsetHeight;
    document.body.style.userSelect = 'none';
    if (e.target.classList.contains('resize-handle')) {
        isResizing = true; resizeHandle = e.target;
    } else if (e.target === signatureBox || e.target === signatureImage) {
        isDragging = true; signatureBox.style.cursor = 'grabbing';
    }
}
function handleMouseMove(e) {
    if (!isDragging && !isResizing) return;
    e.preventDefault();
    const dx = e.clientX - startX; const dy = e.clientY - startY;
    if (isDragging) dragSignature(dx, dy); else if (isResizing) resizeSignature(dx, dy);
}
function handleMouseUp(e) {
    let wasActive = isDragging || isResizing;
    if (isDragging) { isDragging = false; signatureBox.style.cursor = 'move'; }
    if (isResizing) { isResizing = false; resizeHandle = null; }
    if (wasActive && currentCanvas) keepSignatureInBounds(signatureBox);
    document.body.style.userSelect = '';
}
function dragSignature(dx, dy) {
    let newLeft = initialLeft + dx; let newTop = initialTop + dy;
    signatureBox.style.left = `${newLeft}px`; signatureBox.style.top = `${newTop}px`;
}
function resizeSignature(dx, dy) {
    let newLeft = initialLeft; let newTop = initialTop;
    let newWidth = initialWidth; let newHeight = initialHeight;
    const handleClassList = resizeHandle.classList; // Cache classList
    if (handleClassList.contains('cursor-nwse-resize')) {
        if (handleClassList.contains('-bottom-[6px]')) { newWidth = initialWidth + dx; newHeight = initialHeight + dy; }
        else { newWidth = initialWidth - dx; newHeight = initialHeight - dy; newLeft = initialLeft + dx; newTop = initialTop + dy; }
    } else if (handleClassList.contains('cursor-nesw-resize')) {
        if (handleClassList.contains('-bottom-[6px]')) { newWidth = initialWidth - dx; newHeight = initialHeight + dy; newLeft = initialLeft + dx; }
        else { newWidth = initialWidth + dx; newHeight = initialHeight - dy; newTop = initialTop + dy; }
    }
    const minSize = 20;
    if (newWidth < minSize) { newWidth = minSize; if (handleClassList.contains('-left-[6px]')) newLeft = initialLeft + initialWidth - minSize; }
    if (newHeight < minSize) { newHeight = minSize; if (handleClassList.contains('-top-[6px]')) newTop = initialTop + initialHeight - minSize; }
    signatureBox.style.left = `${newLeft}px`; signatureBox.style.top = `${newTop}px`;
    signatureBox.style.width = `${newWidth}px`; signatureBox.style.height = `${newHeight}px`;
}
function keepSignatureInBounds(element) {
    if (!currentCanvas) return;
    const canvasRect = currentCanvas.getBoundingClientRect(); // Use canvas boundary
    // Ensure element position is relative to viewer/canvas parent, not viewport
    let currentX = element.offsetLeft;
    let currentY = element.offsetTop;
    let currentWidth = element.offsetWidth;
    let currentHeight = element.offsetHeight;

    // Max allowed positions based on RENDERED canvas size
    const maxLeft = renderedPageWidth - currentWidth;
    const maxTop = renderedPageHeight - currentHeight;

    // Constrain position
    currentX = Math.max(0, Math.min(currentX, maxLeft));
    currentY = Math.max(0, Math.min(currentY, maxTop));

    // Optionally constrain size if it somehow exceeds canvas dims (less likely with resize logic)
    currentWidth = Math.min(currentWidth, renderedPageWidth);
    currentHeight = Math.min(currentHeight, renderedPageHeight);

    // Apply constrained values
    element.style.left = `${currentX}px`;
    element.style.top = `${currentY}px`;
    element.style.width = `${currentWidth}px`;
    element.style.height = `${currentHeight}px`;
}


// --- Placement Management ---

function addPlacement() {
    // No change needed here, logic relies on activeSignatureId and signatureBox dimensions
    if (!pdfDocProxy || !activeSignatureId || !currentCanvas) {
        setStatus('Cannot add signature. PDF & signature must be loaded/selected.', 'error'); return;
    }
    // Calculate position relative to the CANVAS PARENT (viewer) using offsetLeft/Top
    const finalX = Math.max(0, signatureBox.offsetLeft);
    const finalY = Math.max(0, signatureBox.offsetTop);
    const sigWidth = signatureBox.offsetWidth;
    const sigHeight = signatureBox.offsetHeight;

    // Ensure dimensions don't exceed canvas bounds if placed at edge
    const finalWidth = Math.min(sigWidth, renderedPageWidth - finalX);
    const finalHeight = Math.min(sigHeight, renderedPageHeight - finalY);

    const placementData = {
        placementId: `place_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        signatureId: activeSignatureId, pageNum: currentPageNum - 1, // 0-based index
        x: finalX, y: finalY, widthPx: finalWidth, heightPx: finalHeight,
    };
    // Visually confirm potential constraint adjustments
    signatureBox.style.left = `${finalX}px`; signatureBox.style.top = `${finalY}px`;
    signatureBox.style.width = `${finalWidth}px`; signatureBox.style.height = `${finalHeight}px`;

    placedSignatures.push(placementData);
    renderSinglePersistentPlacement(placementData); // Add static visual representation
    renderPlacedSignaturesList(); // Update summary list
    setStatus(`Signature added to page ${currentPageNum}. Add more or generate PDF.`, 'success');
    updateButtonStates();

    // Optional: Deselect signature after placing
    // setActiveSignature(null);
}

function renderSinglePersistentPlacement(placementData) {
     // No change needed - uses dataUrl from sigData which exists for both types
     const sigData = uploadedSignatures.find(s => s.id === placementData.signatureId);
     if (!sigData) return;
     const placementDiv = document.createElement('div');
     placementDiv.className = 'persistent-placement absolute border border-gray-400 border-dashed z-5 pointer-events-none';
     placementDiv.style.left = `${placementData.x}px`; placementDiv.style.top = `${placementData.y}px`;
     placementDiv.style.width = `${placementData.widthPx}px`; placementDiv.style.height = `${placementData.heightPx}px`;
     placementDiv.dataset.placementId = placementData.placementId;
     const placementImg = document.createElement('img');
     placementImg.src = sigData.dataUrl;
     placementImg.className = 'w-full h-full object-contain opacity-70'; // Slightly transparent?
     placementDiv.appendChild(placementImg);
     viewerContainer.appendChild(placementDiv); // Add to the main viewer div
}

function renderPlacedSignaturesList() {
    // No change needed - uses sigInfo.name which is now set for both types
    placedSignaturesList.innerHTML = '';
    if (placedSignatures.length === 0) {
        placedSignaturesList.innerHTML = '<li class="text-gray-500 italic">No signatures added yet.</li>';
    } else {
        placedSignatures.forEach(p => {
            const sigInfo = uploadedSignatures.find(s => s.id === p.signatureId);
            // Use the name property, shorten if needed
            const sigName = sigInfo ? (sigInfo.name || `ID: ${p.signatureId.substring(0, 8)}...`) : `ID: ${p.signatureId.substring(0, 8)}...`;
            const displayName = sigName.length > 20 ? sigName.substring(0, 17) + '...' : sigName;

            const li = document.createElement('li');
            li.className = "flex justify-between items-center text-xs p-1 bg-gray-50 rounded";
            const textSpan = document.createElement('span');
            textSpan.textContent = `Sig: ${displayName} on Page ${p.pageNum + 1}`; // Show 1-based page number
            li.appendChild(textSpan);
            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.dataset.placementId = p.placementId;
            removeBtn.className = "ml-2 px-1 py-0.5 text-red-600 border border-red-500 rounded text-[10px] hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-300";
            li.appendChild(removeBtn);
            placedSignaturesList.appendChild(li);
        });
    }
     updateButtonStates();
}

function handleRemovePlacement(event) {
    // No change needed here
    if (event.target.tagName === 'BUTTON' && event.target.dataset.placementId) {
        const placementIdToRemove = event.target.dataset.placementId;
        const persistentElement = viewerContainer.querySelector(`.persistent-placement[data-placement-id="${placementIdToRemove}"]`);
        if (persistentElement) persistentElement.remove();
        placedSignatures = placedSignatures.filter(p => p.placementId !== placementIdToRemove);
        renderPlacedSignaturesList();
        setStatus('Signature placement removed.', 'info');
        updateButtonStates();
    }
}


// --- Client-Side PDF Generation using pdf-lib.js ---

// Helper function to read a File object as an ArrayBuffer
function readFileAsArrayBuffer(file) {
    // No change needed here
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

async function generateSignedPdfClientSide() {
    // *** No changes needed here ***
    // This function already relies on `sigData.file` which is now
    // populated correctly for both uploaded and drawn (processed PNG) signatures.
    // pdf-lib's embedPng should handle the transparency correctly.

    if (!pdfFile || placedSignatures.length === 0) {
        setStatus('Please load PDF and add signatures.', 'error');
        return;
    }
    if (renderedPageWidth <= 0 || renderedPageHeight <= 0) {
        setStatus('Error: Page dimensions not available. Render a page first.', 'error');
        return;
    }

    setStatus('Processing PDF in browser...', 'loading');
    generateButton.disabled = true;

    try {
        const pdfBytes = await readFileAsArrayBuffer(pdfFile);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();
        const uniqueSignatureIds = [...new Set(placedSignatures.map(p => p.signatureId))];
        const embeddedSignatures = {};

        for (const sigId of uniqueSignatureIds) {
            const sigData = uploadedSignatures.find(s => s.id === sigId);
            if (!sigData || !sigData.file) { // Check for file object existence
                throw new Error(`Signature file missing for ID: ${sigId}`);
            }

            const sigBytes = await readFileAsArrayBuffer(sigData.file);
            let embeddedImage;
            const fileType = sigData.file.type; // Use the File object's type

            // Drawn signatures are always saved as 'image/png' after processing
            if (fileType === 'image/png') {
                embeddedImage = await pdfDoc.embedPng(sigBytes);
            } else if (fileType === 'image/jpeg') {
                embeddedImage = await pdfDoc.embedJpg(sigBytes);
            } else {
                 // Handle unsupported types (like GIF) if necessary, or throw error
                 console.warn(`Attempting to embed unsupported type ${fileType} for ${sigData.name}. May fail or lose transparency/animation.`);
                  // pdf-lib might handle some basic cases, try PNG embedder as a guess, or error out.
                  // Best practice: enforce PNG/JPG uploads or provide conversion.
                 try {
                      // Try embedding as PNG as a last resort if conversion isn't available
                      embeddedImage = await pdfDoc.embedPng(sigBytes);
                      setStatus(`Warning: Embedded ${sigData.name} (${fileType}) as PNG. Result may vary.`, 'info');
                 } catch (embedError) {
                      throw new Error(`Unsupported signature type: ${fileType} for ${sigData.name}. Use PNG or JPG.`);
                 }
            }
            embeddedSignatures[sigId] = embeddedImage;
        }

        // Draw signatures onto pages
        for (const placement of placedSignatures) {
            if (placement.pageNum < 0 || placement.pageNum >= pages.length) {
                console.warn(`Skipping placement for invalid page number: ${placement.pageNum}`);
                continue;
            }
            const page = pages[placement.pageNum];
            const { width: pageWidthPt, height: pageHeightPt } = page.getSize();

            const embeddedImage = embeddedSignatures[placement.signatureId];
            if (!embeddedImage) {
                console.warn(`Skipping placement as embedded image for ${placement.signatureId} not found.`);
                continue;
            }

            // Scale placement from rendered pixels to PDF points
            const scaleX = pageWidthPt / renderedPageWidth;
            const scaleY = pageHeightPt / renderedPageHeight;
            const sigWidthPt = placement.widthPx * scaleX;
            const sigHeightPt = placement.heightPx * scaleY;
            // Calculate PDF Y coordinate (origin is bottom-left)
            const pdfX = placement.x * scaleX;
            const pdfY = pageHeightPt - (placement.y * scaleY) - sigHeightPt;

            page.drawImage(embeddedImage, {
                x: pdfX,
                y: pdfY,
                width: sigWidthPt,
                height: sigHeightPt,
                // pdf-lib handles PNG transparency automatically when using embedPng
            });
        }

        const modifiedPdfBytes = await pdfDoc.save();
        const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none'; a.href = url;
        a.download = `${pdfFile.name.replace(/\.pdf$/i, '')}_signed.pdf`;
        document.body.appendChild(a); a.click();
        window.URL.revokeObjectURL(url); document.body.removeChild(a);

        setStatus('Signed PDF generated successfully!', 'success');

    } catch (error) {
        console.error('Error generating PDF client-side:', error);
        setStatus(`Error generating PDF: ${error.message || error}`, 'error');
    } finally {
        generateButton.disabled = false; // Re-enable button
        updateButtonStates();
    }
}