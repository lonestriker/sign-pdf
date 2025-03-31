// --- Import PDF.js Library ---
import * as pdfjsLib from './pdf.mjs';

// --- Set Worker Source ---
// Use a relative path assuming pdf.mjs is in the same /static/js/ directory
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';


// --- Globals ---
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

// --- State Variables ---
let pdfDoc = null;
let currentPageNum = 1;
let currentScale = 1.5; // Adjust scale as needed for Tailwind layout
let pdfFile = null;

let uploadedSignatures = []; // { id, file, dataUrl }
let activeSignatureId = null;
let placedSignatures = []; // { placementId, signatureId, pageNum (0-based), x, y, widthPx, heightPx }

let isDragging = false;
let isResizing = false;
let resizeHandle = null;
let startX, startY, initialLeft, initialTop, initialWidth, initialHeight;
let renderedPageWidth = 0;
let renderedPageHeight = 0;
let currentCanvas = null;

// Class constants for status styling using Tailwind classes
const STATUS_CLASSES = {
    info: 'text-blue-600',
    loading: 'text-gray-600 animate-pulse',
    error: 'text-red-600 font-semibold',
    success: 'text-green-600'
};

// --- Initialization ---
updateButtonStates();

// --- Event Listeners ---
pdfFileInput.addEventListener('change', handlePdfUpload);
sigFileInput.addEventListener('change', handleSignatureUpload);
signatureGallery.addEventListener('click', handleGalleryClick);
prevPageButton.addEventListener('click', goToPrevPage);
nextPageButton.addEventListener('click', goToNextPage);
signatureBox.addEventListener('mousedown', startDragOrResize); // Combined listener for active box
document.addEventListener('mousemove', handleMouseMove);       // Global move listener
document.addEventListener('mouseup', handleMouseUp);           // Global mouse up listener
signatureImage.addEventListener('dragstart', (e) => e.preventDefault()); // Prevent native image drag
addSigButton.addEventListener('click', addPlacement);
generateButton.addEventListener('click', generateSignedPdf);
placedSignaturesList.addEventListener('click', handleRemovePlacement); // Listener for removing placements

// --- Functions ---

function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        pdfFile = file;
        const reader = new FileReader();
        reader.onload = function(e) {
            setStatus('Loading PDF...', 'loading');
            const loadingTask = pdfjsLib.getDocument({ data: e.target.result });
            loadingTask.promise.then(doc => {
                pdfDoc = doc;
                pageCountSpan.textContent = pdfDoc.numPages;
                currentPageNum = 1;
                placedSignatures = []; // Reset placements on new PDF load
                renderPlacedSignaturesList();
                clearPersistentPlacements(); // Clear visual divs from previous PDF
                renderPage(currentPageNum);
                setStatus('PDF loaded. Upload signature(s).', 'success');
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
    updateButtonStates();
}

function handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const signatureData = {
                id: `sig_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                file: file,
                dataUrl: e.target.result
            };
            uploadedSignatures.push(signatureData);
            renderSignatureGallery();
            setActiveSignature(signatureData.id); // Auto-select new one
            setStatus('Signature uploaded. Select from gallery to place.', 'success');
        }
        reader.readAsDataURL(file);
        event.target.value = null; // Allow re-uploading same file
    } else {
        setStatus('Please select a valid image file (PNG, JPG, GIF).', 'error');
    }
    updateButtonStates();
}

function renderSignatureGallery() {
    signatureGallery.innerHTML = ''; // Clear existing
    if (uploadedSignatures.length === 0) {
         signatureGallery.innerHTML = '<span class="text-xs text-gray-500 italic">Uploaded signatures will appear here. Click one to activate.</span>';
         return;
    }
    uploadedSignatures.forEach(sig => {
        const img = document.createElement('img');
        img.src = sig.dataUrl;
        img.alt = `Signature ${sig.file.name}`;
        img.dataset.signatureId = sig.id;
        // Apply Tailwind classes for styling the gallery image
        img.className = `h-12 md:h-16 object-contain border-2 border-transparent rounded cursor-pointer hover:border-gray-400`;
        if (sig.id === activeSignatureId) {
            img.classList.add('active-signature'); // Use custom style (defined in HTML <style>) for blue border
        }
        signatureGallery.appendChild(img);
    });
}

function handleGalleryClick(event) {
    // Ensure click is directly on an image with a signature ID
    if (event.target.tagName === 'IMG' && event.target.dataset.signatureId) {
        setActiveSignature(event.target.dataset.signatureId);
    }
}

function setActiveSignature(signatureId) {
    activeSignatureId = signatureId;
    const activeSigData = uploadedSignatures.find(s => s.id === signatureId);
    if (activeSigData) {
        signatureImage.src = activeSigData.dataUrl;
        signatureBox.classList.remove('hidden'); // Show the active placement box
        // Reset size/position for the newly selected signature
        signatureBox.style.left = '10px';
        signatureBox.style.top = '10px';
        signatureBox.style.width = '150px'; // Default width
        signatureBox.style.height = 'auto'; // Let image content determine initial height

        // Use requestAnimationFrame to set height after image potentially loads dimensions
        // This helps ensure the box matches the image aspect ratio initially
        requestAnimationFrame(() => {
            const imgHeight = signatureImage.offsetHeight;
            if (imgHeight > 10) { // Check if image has rendered a valid height
                signatureBox.style.height = `${imgHeight}px`;
            } else {
                 // Fallback if height isn't immediately available
                 signatureBox.style.height = '75px'; // Adjust fallback as needed
            }
            // Ensure initial position is valid relative to the canvas
            if(currentCanvas) {
                keepSignatureInBounds(signatureBox);
            }
        });

    } else {
        // No valid signature selected, hide the active box
        activeSignatureId = null;
        signatureImage.src = '#';
        signatureBox.classList.add('hidden');
    }
    renderSignatureGallery(); // Update visual highlight in the gallery
    updateButtonStates();
}

function renderPage(num) {
    if (!pdfDoc) return;
    setStatus('Rendering page...', 'loading');
    signatureBox.classList.add('hidden'); // Hide active placement box during page render
    clearPersistentPlacements(); // Remove visual divs of previously placed signatures

    pdfDoc.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = "block mx-auto shadow-md"; // Center canvas, add shadow

        // Store rendered dimensions for coordinate calculations
        renderedPageWidth = viewport.width;
        renderedPageHeight = viewport.height;

        // Clear previous canvas and placements, but keep active box structure in DOM
        const persistentPlacements = viewerContainer.querySelectorAll('.persistent-placement');
        persistentPlacements.forEach(el => el.remove());
        const existingCanvas = viewerContainer.querySelector('canvas');
        if (existingCanvas) existingCanvas.remove();

        // Insert the new canvas before the (currently hidden) active signature box
        viewerContainer.insertBefore(canvas, signatureBox);
        currentCanvas = canvas; // Update reference to the current canvas

        const renderContext = { canvasContext: context, viewport: viewport };
        page.render(renderContext).promise.then(() => {
            pageNumSpan.textContent = num; // Update page number display
            setStatus('Page rendered.', 'success');
            updatePageControls(); // Enable/disable prev/next buttons
            renderPersistentPlacementsForPage(num - 1); // Render signatures already placed on THIS page
            // If a signature is active in the gallery, show the placement box again
            if (activeSignatureId) {
                signatureBox.classList.remove('hidden');
                keepSignatureInBounds(signatureBox); // Ensure it's within the new page bounds
            }
        }).catch(err => handleRenderError(err, num)); // Handle canvas rendering errors
    }).catch(err => handleRenderError(err, num)); // Handle page fetching errors
}

function handleRenderError(err, pageNum) {
     console.error(`Error rendering page ${pageNum}:`, err);
     setStatus(`Error rendering page ${pageNum}: ${err.message}`, 'error');
     updatePageControls(); // Still update controls even if rendering failed
}

// Renders the visual divs for signatures already placed on the specified page
function renderPersistentPlacementsForPage(pageNumZeroBased) {
     const placementsForPage = placedSignatures.filter(p => p.pageNum === pageNumZeroBased);
     placementsForPage.forEach(p => {
        renderSinglePersistentPlacement(p); // Reuse the single placement render function
     });
}

// Removes all visual divs representing placed signatures
function clearPersistentPlacements() {
     const persistentPlacements = viewerContainer.querySelectorAll('.persistent-placement');
     persistentPlacements.forEach(el => el.remove());
}

// Updates the enabled/disabled state of pagination buttons
function updatePageControls() {
    if (!pdfDoc) return;
    prevPageButton.disabled = (currentPageNum <= 1);
    nextPageButton.disabled = (currentPageNum >= pdfDoc.numPages);
    // Tailwind's :disabled variant handles the styling automatically
}

function goToPrevPage() {
    if (currentPageNum <= 1) return;
    currentPageNum--;
    renderPage(currentPageNum);
}

function goToNextPage() {
    if (!pdfDoc || currentPageNum >= pdfDoc.numPages) return;
    currentPageNum++;
    renderPage(currentPageNum);
}

// Updates the enabled/disabled state of Add and Generate buttons
function updateButtonStates() {
    addSigButton.disabled = !(pdfDoc && activeSignatureId && currentCanvas);
    generateButton.disabled = !(pdfDoc && placedSignatures.length > 0);
}

// Resets the state related to the loaded PDF
function resetPdfState() {
     pdfDoc = null;
     currentPageNum = 1;
     pageNumSpan.textContent = '0';
     pageCountSpan.textContent = '0';
     const existingCanvas = viewerContainer.querySelector('canvas');
     if (existingCanvas) existingCanvas.remove();
     clearPersistentPlacements();
     signatureBox.classList.add('hidden'); // Hide active box
     updatePageControls();
     renderedPageWidth = 0;
     renderedPageHeight = 0;
     currentCanvas = null;
     pdfFile = null;
     placedSignatures = []; // Clear placed signature data
     renderPlacedSignaturesList(); // Update the summary list
     updateButtonStates();
}

// Resets only the active signature selection from the gallery
function resetSignatureSelectionState() {
    activeSignatureId = null;
    signatureImage.src = '#';
    signatureBox.classList.add('hidden');
    renderSignatureGallery(); // Update gallery visual state
    updateButtonStates();
}

// Sets the status message and applies corresponding Tailwind classes
function setStatus(message, type = 'info') {
    statusDiv.textContent = message;
    // Clear previous status classes
    Object.values(STATUS_CLASSES).forEach(cls => statusDiv.classList.remove(...cls.split(' ')));
    // Add new status class(es) if defined
    if (STATUS_CLASSES[type]) {
        statusDiv.classList.add(...STATUS_CLASSES[type].split(' '));
    }
}

// --- Drag and Resize Logic ---

// Combined mousedown listener for the active signature box
function startDragOrResize(e) {
    // Only proceed if a signature is active and PDF page is rendered
    if (!activeSignatureId || !pdfDoc || !currentCanvas) return;

    // Record starting mouse position and initial box properties
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = signatureBox.offsetLeft;
    initialTop = signatureBox.offsetTop;
    initialWidth = signatureBox.offsetWidth;
    initialHeight = signatureBox.offsetHeight;
    document.body.style.userSelect = 'none'; // Prevent text selection during operation

    // Check if a resize handle was clicked
    if (e.target.classList.contains('resize-handle')) {
        isResizing = true;
        resizeHandle = e.target; // Store the specific handle being dragged
    }
    // Check if the box background or image was clicked (initiate drag)
    else if (e.target === signatureBox || e.target === signatureImage) {
         isDragging = true;
         signatureBox.style.cursor = 'grabbing'; // Change cursor for dragging
    }
}

// Global mouse move handler - routes to drag or resize function if active
function handleMouseMove(e) {
    if (!isDragging && !isResizing) return;

    e.preventDefault(); // Prevent other default actions during drag/resize

    // Calculate change in mouse position
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (isDragging) {
        dragSignature(dx, dy);
    } else if (isResizing) {
        resizeSignature(dx, dy);
    }
}

// Global mouse up handler - ends drag/resize operations
function handleMouseUp(e) {
    let wasActive = isDragging || isResizing; // Check if an operation was in progress

    if (isDragging) {
        isDragging = false;
        signatureBox.style.cursor = 'move'; // Reset cursor
    }
    if (isResizing) {
        isResizing = false;
        resizeHandle = null;
    }

    // If an operation just ended, ensure the box is within canvas bounds
    if (wasActive && currentCanvas) {
         keepSignatureInBounds(signatureBox);
    }

    document.body.style.userSelect = ''; // Re-enable text selection
}

// Updates position during drag
function dragSignature(dx, dy) {
    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;
    signatureBox.style.left = `${newLeft}px`;
    signatureBox.style.top = `${newTop}px`;
    // Final bounds check happens on mouseup
}

// Updates position and dimensions during resize
function resizeSignature(dx, dy) {
    let newLeft = initialLeft;
    let newTop = initialTop;
    let newWidth = initialWidth;
    let newHeight = initialHeight;

    // Determine new dimensions/position based on which handle is dragged
    // Uses Tailwind cursor classes to identify handle type
    if (resizeHandle.classList.contains('cursor-nwse-resize')) { // Bottom-right or Top-left handle
         if (resizeHandle.classList.contains('-bottom-[6px]')) { // Bottom-right
             newWidth = initialWidth + dx;
             newHeight = initialHeight + dy;
         } else { // Top-left
              newWidth = initialWidth - dx;
              newHeight = initialHeight - dy;
              newLeft = initialLeft + dx; // Position moves as size changes from top/left
              newTop = initialTop + dy;
         }
    } else if (resizeHandle.classList.contains('cursor-nesw-resize')) { // Bottom-left or Top-right handle
        if (resizeHandle.classList.contains('-bottom-[6px]')) { // Bottom-left
             newWidth = initialWidth - dx;
             newHeight = initialHeight + dy;
             newLeft = initialLeft + dx; // Position moves as size changes from left
        } else { // Top-right
             newWidth = initialWidth + dx;
             newHeight = initialHeight - dy;
             newTop = initialTop + dy; // Position moves as size changes from top
        }
    }

    // Enforce minimum size
    const minSize = 20; // Minimum pixels
    if (newWidth < minSize) {
        newWidth = minSize;
        // Adjust position if shrinking from left/right handle to avoid jump
        if (resizeHandle.classList.contains('-left-[6px]')) newLeft = initialLeft + initialWidth - minSize;
    }
     if (newHeight < minSize) {
         newHeight = minSize;
          // Adjust position if shrinking from top/bottom handle
         if (resizeHandle.classList.contains('-top-[6px]')) newTop = initialTop + initialHeight - minSize;
     }

    // Apply new styles to the active placement box
    signatureBox.style.left = `${newLeft}px`;
    signatureBox.style.top = `${newTop}px`;
    signatureBox.style.width = `${newWidth}px`;
    signatureBox.style.height = `${newHeight}px`;
    // Final bounds check happens on mouseup
}

// Ensures the provided element (usually the active signatureBox) stays within the canvas boundaries
function keepSignatureInBounds(element) {
    if (!currentCanvas) return; // Exit if canvas isn't rendered

    // Use getBoundingClientRect for positions relative to viewport
    const canvasRect = currentCanvas.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Calculate current position relative to the canvas's top-left corner
    let relativeX = elementRect.left - canvasRect.left;
    let relativeY = elementRect.top - canvasRect.top;
    let currentWidth = element.offsetWidth; // Get visual width
    let currentHeight = element.offsetHeight; // Get visual height

    // Determine maximum allowed top/left based on canvas dimensions and element size
    const maxLeft = renderedPageWidth - currentWidth;
    const maxTop = renderedPageHeight - currentHeight;

    // Constrain the relative position
    relativeX = Math.max(0, Math.min(relativeX, maxLeft));
    relativeY = Math.max(0, Math.min(relativeY, maxTop));

    // Constrain dimensions (important if resizing made it larger than canvas)
    currentWidth = Math.min(currentWidth, renderedPageWidth);
    currentHeight = Math.min(currentHeight, renderedPageHeight);

    // Apply the constrained position and size back to the element's style
    // Using relativeX/Y ensures it's positioned correctly relative to the canvas origin
    element.style.left = `${relativeX}px`;
    element.style.top = `${relativeY}px`;
    element.style.width = `${currentWidth}px`;
    element.style.height = `${currentHeight}px`;
}


// --- Placement Management ---

// Adds the currently active signature's position/size to the placedSignatures array
function addPlacement() {
    if (!pdfDoc || !activeSignatureId || !currentCanvas) {
        setStatus('Cannot add signature. PDF & signature must be loaded/selected.', 'error');
        return;
    }

    // --- Calculate final position relative to the CANVAS ---
    const canvasRect = currentCanvas.getBoundingClientRect();
    const signatureRect = signatureBox.getBoundingClientRect();
    const relativeX = signatureRect.left - canvasRect.left;
    const relativeY = signatureRect.top - canvasRect.top;
    const sigWidth = signatureBox.offsetWidth;
    const sigHeight = signatureBox.offsetHeight;

    // Constrain coordinates and size to ensure they are within canvas bounds
    const finalX = Math.max(0, Math.min(relativeX, renderedPageWidth - sigWidth));
    const finalY = Math.max(0, Math.min(relativeY, renderedPageHeight - sigHeight));
    const finalWidth = Math.min(sigWidth, renderedPageWidth);
    const finalHeight = Math.min(sigHeight, renderedPageHeight);

    // Store the finalized placement data
    const placementData = {
        placementId: `place_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        signatureId: activeSignatureId,
        pageNum: currentPageNum - 1, // 0-based index
        x: finalX,
        y: finalY,
        widthPx: finalWidth,
        heightPx: finalHeight,
    };

    // Visually update the ACTIVE box to reflect the final constrained position/size
    signatureBox.style.left = `${finalX}px`;
    signatureBox.style.top = `${finalY}px`;
    signatureBox.style.width = `${finalWidth}px`;
    signatureBox.style.height = `${finalHeight}px`;

    placedSignatures.push(placementData); // Add data to our array

    renderSinglePersistentPlacement(placementData); // Create the persistent visual element
    renderPlacedSignaturesList(); // Update the text summary list
    setStatus(`Signature added to page ${currentPageNum}. Add more or generate PDF.`, 'success');
    updateButtonStates();

    // Optional: De-select the active signature after placing it
    // setActiveSignature(null);
}

// Renders a single persistent (non-interactive) visual div for a placed signature
function renderSinglePersistentPlacement(placementData) {
     const sigData = uploadedSignatures.find(s => s.id === placementData.signatureId);
     if (!sigData) return; // Signature data must exist

     const placementDiv = document.createElement('div');
     // Apply Tailwind classes for styling the persistent div
     placementDiv.className = 'persistent-placement absolute border border-gray-400 border-dashed z-5 pointer-events-none';
     placementDiv.style.left = `${placementData.x}px`; // Use final X coordinate
     placementDiv.style.top = `${placementData.y}px`; // Use final Y coordinate
     placementDiv.style.width = `${placementData.widthPx}px`;
     placementDiv.style.height = `${placementData.heightPx}px`;
     placementDiv.dataset.placementId = placementData.placementId; // Store ID for removal

     const placementImg = document.createElement('img');
     placementImg.src = sigData.dataUrl;
     placementImg.className = 'w-full h-full object-contain'; // Make image fill the div

     placementDiv.appendChild(placementImg);
     viewerContainer.appendChild(placementDiv); // Add to the main viewer area
}

// Updates the text list summarizing placed signatures
function renderPlacedSignaturesList() {
    placedSignaturesList.innerHTML = ''; // Clear current list
    if (placedSignatures.length === 0) {
        placedSignaturesList.innerHTML = '<li class="text-gray-500 italic">No signatures added yet.</li>';
    } else {
        placedSignatures.forEach(p => {
            const sigInfo = uploadedSignatures.find(s => s.id === p.signatureId);
            // Provide fallback name if original file data missing (shouldn't happen)
            const sigName = sigInfo ? sigInfo.file.name.substring(0, 15)+'...' : `ID: ${p.signatureId.substring(0, 8)}...`;

            const li = document.createElement('li');
            // Apply Tailwind classes for list item styling
            li.className = "flex justify-between items-center text-xs p-1 bg-gray-50 rounded";

            const textSpan = document.createElement('span');
            textSpan.textContent = `Sig: ${sigName} on Page ${p.pageNum + 1}`; // Display 1-based page number
            li.appendChild(textSpan);

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.dataset.placementId = p.placementId; // Link button to data
            // Apply Tailwind classes for remove button styling
            removeBtn.className = "ml-2 px-1 py-0.5 text-red-600 border border-red-500 rounded text-[10px] hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-300";
            li.appendChild(removeBtn);

            placedSignaturesList.appendChild(li);
        });
    }
     updateButtonStates(); // Ensure generate button state is correct
}

// Handles clicks on the "Remove" buttons in the placement summary list
function handleRemovePlacement(event) {
    // Check if a remove button was clicked and has a placement ID
    if (event.target.tagName === 'BUTTON' && event.target.dataset.placementId) {
        const placementIdToRemove = event.target.dataset.placementId;

        // Remove the corresponding visual persistent element from the viewer
        const persistentElement = viewerContainer.querySelector(`.persistent-placement[data-placement-id="${placementIdToRemove}"]`);
        if (persistentElement) {
             persistentElement.remove();
        }

        // Remove the data from the placedSignatures array
        placedSignatures = placedSignatures.filter(p => p.placementId !== placementIdToRemove);

        renderPlacedSignaturesList(); // Re-render the text list
        setStatus('Signature placement removed.', 'info');
        updateButtonStates(); // Update button states based on remaining placements
    }
}

// --- Final PDF Generation ---

// Collects data and sends it to the backend to generate the signed PDF
function generateSignedPdf() {
    if (!pdfFile || placedSignatures.length === 0) {
        setStatus('Please load PDF and add signatures.', 'error');
        return;
    }
    // Ensure we have page dimensions from a rendered page
    if (renderedPageWidth <= 0 || renderedPageHeight <= 0) {
         setStatus('Error: Page dimensions not available. Please render a page first.', 'error');
         return;
    }

    setStatus('Processing PDF...', 'loading');
    generateButton.disabled = true; // Disable button during processing

    const formData = new FormData();

    // 1. Add the original PDF file
    formData.append('pdfFile', pdfFile);

    // 2. Add unique signature image files used in placements
    const uniqueSignatureIds = [...new Set(placedSignatures.map(p => p.signatureId))];
    let filesIncludedCount = 0;
    uniqueSignatureIds.forEach(sigId => {
        const sigData = uploadedSignatures.find(s => s.id === sigId);
        if (sigData) {
            // Backend expects keys like 'signatureFiles[signatureId]'
            formData.append(`signatureFiles[${sigId}]`, sigData.file, sigData.file.name);
            filesIncludedCount++;
        } else {
             // This case should ideally not happen if data is consistent
             console.warn(`Signature file data not found for ID: ${sigId} during PDF generation.`);
        }
    });

    // Safety check: ensure at least one signature file is being sent if placements exist
     if (filesIncludedCount === 0 && placedSignatures.length > 0) {
         setStatus('Error: Could not find signature image files for placed items.', 'error');
         generateButton.disabled = false; // Re-enable button
         return;
     }

    // 3. Add Placement Data (array of objects) as a JSON string
    formData.append('placements', JSON.stringify(placedSignatures));

    // 4. Add Rendered Page Dimensions (used for backend scaling)
    formData.append('pageWidthPx', renderedPageWidth);
    formData.append('pageHeightPx', renderedPageHeight);

    // --- Send Data to Backend ---
    fetch('/sign', { // Target the Flask endpoint
        method: 'POST',
        body: formData // FormData handles multipart encoding automatically
    })
    .then(response => {
        if (!response.ok) { // Check for HTTP errors (4xx, 5xx)
            // Try to parse detailed error message from Flask backend (sent as JSON)
            return response.json().then(errData => {
                throw new Error(errData.error?.message || `Server error: ${response.status}`);
            }).catch(() => { // Fallback if parsing JSON fails
                 throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`);
            });
        }
        // If response is OK (2xx), expect the signed PDF file as a blob
        return response.blob();
    })
    .then(blob => { // Handle successful PDF generation
        setStatus('Signed PDF ready for download.', 'success');
        // Create a temporary URL and link to trigger download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'signed_document.pdf'; // Suggested filename for download
        document.body.appendChild(a);
        a.click(); // Simulate click to start download
        window.URL.revokeObjectURL(url); // Clean up the temporary URL
        document.body.removeChild(a); // Remove the temporary link
        // Re-enable button after a short delay to allow download to start
        setTimeout(() => { generateButton.disabled = false; updateButtonStates(); }, 500);
    })
    .catch(error => { // Handle errors from fetch() or response processing
        console.error('Signing error:', error);
        setStatus(`Signing failed: ${error.message}`, 'error');
        generateButton.disabled = false; // Re-enable button on failure
        updateButtonStates();
    });
}