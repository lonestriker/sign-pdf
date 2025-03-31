/**
 * script.js - ES Module Version
 * Frontend logic for the PDF Signature Tool (Python Backend Version)
 */

// --- Import Required Libraries ---
import * as pdfjsLib from './pdf.mjs'; // Import PDF.js library

// --- Configure PDF.js Worker ---
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

// --- Access Globally Loaded Libraries ---
const SignaturePad = window.SignaturePad; // SignaturePad loaded via <script>

// --- Globals (DOM Elements - declare with let, assign in DOMContentLoaded) ---
let tabButtons, tabContents, pdfFileInput, sigUploadArea, sigDrawArea, showUploadBtn,
    showDrawBtn, openDrawModalBtn, sigFileInput, signatureGallery, viewerContainer,
    signatureBox, signatureImage, prevPageButton, nextPageButton, pageNumSpan,
    pageCountSpan, addSigButton, generateButton, statusDiv, placedSignaturesList,
    convertSigFileInput, convertButton, convertStatusDiv, convertResultArea,
    convertedSigPreview, downloadConvertedLink, signatureModal, signaturePadCanvas,
    clearSignatureBtn, saveSignatureBtn, closeSignatureModalBtn;

// --- State Variables ---
let pdfDocProxy = null; let currentPageNum = 1; let currentScale = 1.5; let pdfFile = null;
let uploadedSignatures = []; let activeSignatureId = null; let placedSignatures = [];
let isDragging = false; let isResizing = false; let resizeHandle = null;
let startX, startY, initialLeft, initialTop, initialWidth, initialHeight;
let renderedPageWidth = 0; let renderedPageHeight = 0; let currentCanvas = null;
let convertSigFile = null; let convertedBlobUrl = null;
let signaturePad = null;

// Tailwind classes for status messages
const STATUS_CLASSES = {
    info: 'text-blue-600',
    loading: 'text-gray-600 animate-pulse',
    error: 'text-red-600 font-semibold',
    success: 'text-green-600'
};


// ==========================================================
// ========= FUNCTION DEFINITIONS ===========================
// ==========================================================

/**
 * Sets up tab switching behavior.
 */
function setupTabs() {
    if (!tabButtons || tabButtons.length === 0 || !tabContents || tabContents.length === 0) {
        console.error("Tab elements not found during setup.");
        return;
    }
    // Ensure default active tab is displayed
     const activeContent = document.querySelector('.tab-content.active');
     if (activeContent) activeContent.style.display = 'block';
     tabContents.forEach(content => {
         if (!content.classList.contains('active')) { content.style.display = 'none'; }
     });

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            tabContents.forEach(content => {
                const isActive = content.id === `tab-content-${targetTab}`;
                content.style.display = isActive ? 'block' : 'none';
                if(isActive) content.classList.add('active');
                else content.classList.remove('active');
            });
        });
    });
}

/** Sets up the toggle between Upload File and Draw Signature modes. */
function setupSignatureInputToggle() {
    showUploadMode(); // Default to upload mode
}

/** Shows the file upload input and hides the draw button. */
function showUploadMode() {
    if (!sigUploadArea || !sigDrawArea || !showUploadBtn || !showDrawBtn) return;
    sigUploadArea.classList.remove('hidden');
    sigDrawArea.classList.add('hidden');
    showUploadBtn.classList.add('bg-white', 'text-blue-600', 'border-blue-500');
    showUploadBtn.classList.remove('bg-gray-200', 'text-gray-700', 'border-gray-300');
    showDrawBtn.classList.add('bg-gray-200', 'text-gray-700', 'border-gray-300');
    showDrawBtn.classList.remove('bg-white', 'text-blue-600', 'border-blue-500');
}

/** Shows the draw button and hides the file upload input. */
function showDrawMode() {
    if (!sigUploadArea || !sigDrawArea || !showUploadBtn || !showDrawBtn) return;
    sigUploadArea.classList.add('hidden');
    sigDrawArea.classList.remove('hidden');
    showDrawBtn.classList.add('bg-white', 'text-blue-600', 'border-blue-500');
    showDrawBtn.classList.remove('bg-gray-200', 'text-gray-700', 'border-gray-300');
    showUploadBtn.classList.add('bg-gray-200', 'text-gray-700', 'border-gray-300');
    showUploadBtn.classList.remove('bg-white', 'text-blue-600', 'border-blue-500');
}

/** Opens the signature drawing modal. */
function openSignatureModal() {
    if (!signatureModal) return;
    signatureModal.classList.remove('hidden');
    signatureModal.classList.add('flex');
    initializeSignaturePad();
}

/** Closes the signature drawing modal. */
function closeSignatureModal() {
    if (!signatureModal) return;
    signatureModal.classList.add('hidden');
    signatureModal.classList.remove('flex');
    if (signaturePad) signaturePad.off(); // Clean up listeners
}

/** Initializes or reinitializes the SignaturePad instance. */
function initializeSignaturePad() {
    if (!signaturePadCanvas) {
        console.error("Signature pad canvas not found during initialization.");
        return;
    }
    if (typeof SignaturePad === 'undefined') { // Check global scope
         console.error("SignaturePad library not loaded!");
         setStatus("Error: Signature drawing library failed to load.", "error", statusDiv); // Use main status div
         closeSignatureModal();
         return;
    }
    resizeCanvas(); // Resize first
    if (signaturePad) signaturePad.off();
    signaturePad = new SignaturePad(signaturePadCanvas, { // Use constructor directly
         backgroundColor: 'rgb(255, 255, 255)', penColor: 'rgb(0, 0, 0)'
    });
    signaturePad.clear();
}

/** Resizes the signature pad canvas based on its display size and pixel ratio. */
function resizeCanvas() {
    if (!signaturePadCanvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    signaturePadCanvas.width = signaturePadCanvas.offsetWidth * ratio;
    signaturePadCanvas.height = signaturePadCanvas.offsetHeight * ratio;
    const ctx = signaturePadCanvas.getContext("2d");
    if (ctx) { // Check if context exists
        ctx.scale(ratio, ratio);
        if (signaturePad) signaturePad.clear(); // Clear after resize
    } else {
        console.error("Failed to get 2D context for signature pad canvas.");
    }
}

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
        setStatus("Error processing drawn signature.", "error", statusDiv); // Show error
        return null;
    }
}

/** Saves the signature drawn on the pad to the gallery. */
function saveDrawnSignature() {
    if (!signaturePad || signaturePad.isEmpty()) { alert("Please provide a signature first."); return; }
    const dataURL = signaturePad.toDataURL('image/png'); // Get as PNG
    const timestamp = Date.now(); const filename = `signature_${timestamp}.png`;
    const signatureFileObject = dataURLtoFile(dataURL, filename);
    if (!signatureFileObject) return; // Error handled in helper
    const signatureData = { id: `sig_${timestamp}_${Math.random().toString(16).slice(2)}`, file: signatureFileObject, dataUrl: dataURL };
    uploadedSignatures.push(signatureData);
    renderSignatureGallery();
    setActiveSignature(signatureData.id); // Select the new one
    setStatus('Drawn signature saved and selected.', 'success', statusDiv);
    closeSignatureModal();
}

/** Handles PDF file selection, loads and renders the first page using PDF.js. */
function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        pdfFile = file;
        const reader = new FileReader();
        reader.onload = function(e) {
            // *** Use the correct statusDiv variable ***
            setStatus('Loading PDF...', 'loading', statusDiv);
            // Check pdfjsLib again before use
            if (!pdfjsLib) { setStatus('Error: PDF library not loaded.', 'error', statusDiv); return; }

            const loadingTask = pdfjsLib.getDocument({ data: e.target.result });
            loadingTask.promise.then(doc => {
                pdfDocProxy = doc;
                if(pageCountSpan) pageCountSpan.textContent = pdfDocProxy.numPages;
                else console.warn("pageCountSpan element not found");
                currentPageNum = 1; placedSignatures = [];
                renderPlacedSignaturesList(); clearPersistentPlacements();
                renderPage(currentPageNum); // Render first page
                 // *** Use the correct statusDiv variable ***
                setStatus('PDF loaded. Add signature(s).', 'success', statusDiv);
            }).catch(err => {
                console.error("Error loading PDF:", err);
                // *** Use the correct statusDiv variable ***
                setStatus(`Error loading PDF: ${err.message || err}`, 'error', statusDiv);
                resetPdfState();
            });
        };
        reader.readAsArrayBuffer(file);
    } else {
         // *** Use the correct statusDiv variable ***
        setStatus('Please select a valid PDF file.', 'error', statusDiv);
        resetPdfState(); pdfFile = null;
    }
    updateButtonStates();
}

/** Handles signature image file upload. */
function handleSignatureUpload(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const signatureData = { id: `sig_${Date.now()}_${Math.random().toString(16).slice(2)}`, file: file, dataUrl: e.target.result };
            uploadedSignatures.push(signatureData);
            renderSignatureGallery(); setActiveSignature(signatureData.id);
            // *** Use the correct statusDiv variable ***
            setStatus('Signature uploaded. Select from gallery to place.', 'success', statusDiv);
        }
        reader.readAsDataURL(file);
        event.target.value = null; // Allow re-upload
    } else {
        // *** Use the correct statusDiv variable ***
        setStatus('Please select a valid image file.', 'error', statusDiv);
    }
    updateButtonStates();
}

/** Renders a specific PDF page using PDF.js. */
function renderPage(num) {
    if (!pdfDocProxy || !viewerContainer) return;
    // *** Use the correct statusDiv variable ***
    setStatus('Rendering page...', 'loading', statusDiv);
    if(signatureBox) signatureBox.classList.add('hidden');
    clearPersistentPlacements();

    pdfDocProxy.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) { // Check if context was obtained
             handleRenderError(new Error("Failed to get 2D context"), num); return;
        }
        canvas.height = viewport.height; canvas.width = viewport.width;
        canvas.className = "block mx-auto shadow-md";
        renderedPageWidth = viewport.width; renderedPageHeight = viewport.height;
        const existingCanvas = viewerContainer.querySelector('canvas'); if (existingCanvas) existingCanvas.remove();
        viewerContainer.insertBefore(canvas, signatureBox);
        currentCanvas = canvas;
        const renderContext = { canvasContext: context, viewport: viewport };
        page.render(renderContext).promise.then(() => {
            if (pageNumSpan) pageNumSpan.textContent = num;
            // *** Use the correct statusDiv variable ***
            setStatus('Page rendered.', 'success', statusDiv);
            updatePageControls(); renderPersistentPlacementsForPage(num - 1);
            if (activeSignatureId && signatureBox) { signatureBox.classList.remove('hidden'); keepSignatureInBounds(signatureBox); }
        }).catch(err => handleRenderError(err, num));
    }).catch(err => handleRenderError(err, num));
}

/** Renders the gallery of available signatures. */
function renderSignatureGallery() {
    if (!signatureGallery) return;
    signatureGallery.innerHTML = '';
    if (uploadedSignatures.length === 0) {
         signatureGallery.innerHTML = '<span class="text-xs text-gray-500 italic">Signatures added via Upload or Draw will appear here.</span>'; return;
    }
    uploadedSignatures.forEach(sig => {
        const img = document.createElement('img');
        img.src = sig.dataUrl; img.alt = `Signature Preview ${sig.id}`; img.dataset.signatureId = sig.id;
        img.className = `h-12 md:h-16 object-contain border-2 border-transparent rounded cursor-pointer hover:border-gray-400`;
        if (sig.id === activeSignatureId) img.classList.add('active-signature');
        signatureGallery.appendChild(img);
    });
}

/** Handles clicks within the signature gallery. */
function handleGalleryClick(event) { if (event.target.tagName === 'IMG' && event.target.dataset.signatureId) setActiveSignature(event.target.dataset.signatureId); }

/**
 * Sets the currently active signature for placement.
 * @param {string} signatureId - The ID of the signature to activate.
 */
function setActiveSignature(signatureId) {
    activeSignatureId = signatureId;
    const activeSigData = uploadedSignatures.find(s => s.id === signatureId);

    if (activeSigData && signatureBox && signatureImage) {
        signatureImage.src = activeSigData.dataUrl;
        signatureBox.classList.remove('hidden');
        // Reset position/size for the newly activated signature
        signatureBox.style.left = '10px'; signatureBox.style.top = '10px';
        signatureBox.style.width = '150px'; signatureBox.style.height = 'auto';
        // Adjust height based on image aspect ratio after it potentially loads
        requestAnimationFrame(() => {
            const imgHeight = signatureImage.offsetHeight;
            signatureBox.style.height = imgHeight > 10 ? `${imgHeight}px` : '75px'; // Use fallback height if needed
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

/** Handles errors during PDF page rendering. */
function handleRenderError(err, pageNum) {
    console.error(`Error rendering page ${pageNum}:`, err);
    // *** Use the correct statusDiv variable ***
    setStatus(`Error rendering page ${pageNum}: ${err.message || err}`, 'error', statusDiv);
    updatePageControls();
}

/** Renders the visual divs for signatures already placed on the current page. */
function renderPersistentPlacementsForPage(pageNumZeroBased) { placedSignatures.filter(p => p.pageNum === pageNumZeroBased).forEach(renderSinglePersistentPlacement); }

/** Removes all visual divs representing placed signatures. */
function clearPersistentPlacements() { if (viewerContainer) viewerContainer.querySelectorAll('.persistent-placement').forEach(el => el.remove()); }

/** Updates the enabled/disabled state of pagination buttons. */
function updatePageControls() { if (!pdfDocProxy || !prevPageButton || !nextPageButton) return; prevPageButton.disabled = (currentPageNum <= 1); nextPageButton.disabled = (currentPageNum >= pdfDocProxy.numPages); }

/** Navigates to the previous PDF page. */
function goToPrevPage() { if (currentPageNum > 1) { currentPageNum--; renderPage(currentPageNum); } }

/** Navigates to the next PDF page. */
function goToNextPage() { if (pdfDocProxy && currentPageNum < pdfDocProxy.numPages) { currentPageNum++; renderPage(currentPageNum); } }

/** Updates the enabled/disabled state of main action buttons. */
function updateButtonStates() {
   if (addSigButton) addSigButton.disabled = !(pdfDocProxy && activeSignatureId && currentCanvas);
   if (generateButton) generateButton.disabled = !(pdfDocProxy && placedSignatures.length > 0);
   if (convertButton) convertButton.disabled = !convertSigFile;
}

/** Resets the state related to the currently loaded PDF. */
function resetPdfState() {
    pdfDocProxy = null; currentPageNum = 1;
    if(pageNumSpan) pageNumSpan.textContent = '0'; if(pageCountSpan) pageCountSpan.textContent = '0';
    if(viewerContainer) { const c = viewerContainer.querySelector('canvas'); if (c) c.remove(); }
    clearPersistentPlacements(); if(signatureBox) signatureBox.classList.add('hidden');
    updatePageControls(); renderedPageWidth = 0; renderedPageHeight = 0; currentCanvas = null; pdfFile = null;
    placedSignatures = []; renderPlacedSignaturesList(); activeSignatureId = null; renderSignatureGallery(); updateButtonStates();
}

/** Sets a status message in a target div with styling. */
function setStatus(message, type = 'info', targetDiv) {
   if (!targetDiv) { // Check if targetDiv is valid
       console.warn(`setStatus called with null or undefined targetDiv for message: "${message}"`);
       // Fallback to main statusDiv if it exists, otherwise log error and exit
       if (statusDiv) {
            targetDiv = statusDiv;
            console.warn("Falling back to main statusDiv.");
       } else {
           console.error("Cannot set status, targetDiv is invalid and fallback statusDiv is also unavailable.");
           return;
       }
   }
   targetDiv.textContent = message;
   Object.values(STATUS_CLASSES).forEach(cls => targetDiv.classList.remove(...cls.split(' ')));
   if (STATUS_CLASSES[type]) targetDiv.classList.add(...STATUS_CLASSES[type].split(' '));
}


/**
 * Handles the start of dragging or resizing the active signature box.
 * @param {MouseEvent} e - The mousedown event.
 */
function startDragOrResize(e) {
    // Ignore if not on the active box, or if PDF/canvas isn't ready
    if (!activeSignatureId || !pdfDocProxy || !currentCanvas || !signatureBox) return;

    startX = e.clientX; startY = e.clientY;
    initialLeft = signatureBox.offsetLeft; initialTop = signatureBox.offsetTop;
    initialWidth = signatureBox.offsetWidth; initialHeight = signatureBox.offsetHeight;
    document.body.style.userSelect = 'none'; // Prevent text selection during drag/resize

    if (e.target.classList.contains('resize-handle')) {
        isResizing = true; resizeHandle = e.target;
    } else if (e.target === signatureBox || e.target === signatureImage) {
        isDragging = true; signatureBox.style.cursor = 'grabbing';
    }
}

/**
 * Handles mouse movement during drag or resize operations.
 * @param {MouseEvent} e - The mousemove event.
 */
function handleMouseMove(e) {
    if (!isDragging && !isResizing) return; // Only act if an operation is active
    e.preventDefault(); // Prevent unwanted default actions (like text selection)
    const dx = e.clientX - startX; const dy = e.clientY - startY;
    if (isDragging) {
        dragSignature(dx, dy);
    } else if (isResizing) {
        resizeSignature(dx, dy);
    }
}

/**
 * Handles the end of dragging or resizing operations (mouseup).
 * @param {MouseEvent} e - The mouseup event.
 */
function handleMouseUp(e) {
    let wasActive = isDragging || isResizing; // Record if an operation was happening

    if (isDragging) {
        isDragging = false;
        if(signatureBox) signatureBox.style.cursor = 'move'; // Reset cursor
    }
    if (isResizing) {
        isResizing = false;
        resizeHandle = null;
    }
    // If an operation just ended, ensure the box is within bounds
    if (wasActive && currentCanvas && signatureBox) {
         keepSignatureInBounds(signatureBox);
    }
    document.body.style.userSelect = ''; // Re-enable text selection
}

/**
 * Updates the position of the signature box during dragging.
 * @param {number} dx - Change in X coordinate.
 * @param {number} dy - Change in Y coordinate.
 */
function dragSignature(dx, dy) {
    if(!signatureBox) return;
    let newLeft = initialLeft + dx; let newTop = initialTop + dy;
    signatureBox.style.left = `${newLeft}px`; signatureBox.style.top = `${newTop}px`;
    // Bounds check happens on mouse up for smoother dragging
}

/**
 * Updates the position and size of the signature box during resizing.
 * @param {number} dx - Change in X coordinate.
 * @param {number} dy - Change in Y coordinate.
 */
function resizeSignature(dx, dy) {
    if(!signatureBox || !resizeHandle) return;
    let newLeft = initialLeft; let newTop = initialTop;
    let newWidth = initialWidth; let newHeight = initialHeight;
    const handleClassList = resizeHandle.classList;

    // Logic based on Tailwind cursor classes used for handles
    if (handleClassList.contains('cursor-nwse-resize')) { // Bottom-right or Top-left handle
        if (handleClassList.contains('-bottom-[6px]')) { // Bottom-right
            newWidth = initialWidth + dx; newHeight = initialHeight + dy;
        } else { // Top-left
             newWidth = initialWidth - dx; newHeight = initialHeight - dy;
             newLeft = initialLeft + dx; newTop = initialTop + dy;
        }
   } else if (handleClassList.contains('cursor-nesw-resize')) { // Bottom-left or Top-right handle
       if (handleClassList.contains('-bottom-[6px]')) { // Bottom-left
            newWidth = initialWidth - dx; newHeight = initialHeight + dy;
            newLeft = initialLeft + dx;
       } else { // Top-right
            newWidth = initialWidth + dx; newHeight = initialHeight - dy;
            newTop = initialTop + dy;
       }
   }

    // Enforce minimum size
    const minSize = 20;
    if (newWidth < minSize) {
        newWidth = minSize;
        if (handleClassList.contains('-left-[6px]')) newLeft = initialLeft + initialWidth - minSize; // Adjust position slightly
    }
     if (newHeight < minSize) {
         newHeight = minSize;
         if (handleClassList.contains('-top-[6px]')) newTop = initialTop + initialHeight - minSize; // Adjust position slightly
     }

    signatureBox.style.left = `${newLeft}px`; signatureBox.style.top = `${newTop}px`;
    signatureBox.style.width = `${newWidth}px`; signatureBox.style.height = `${newHeight}px`;
    // Bounds check happens on mouse up
}

/**
 * Ensures the provided element (signature box) stays within the bounds of the current canvas.
 * @param {HTMLElement} element - The element to constrain (usually signatureBox).
 */
function keepSignatureInBounds(element) {
    if (!currentCanvas || !element) return; // Need both canvas and element

    const canvasRect = currentCanvas.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Calculate element's current position relative to the canvas origin
    let relativeX = elementRect.left - canvasRect.left;
    let relativeY = elementRect.top - canvasRect.top;
    let currentWidth = element.offsetWidth;
    let currentHeight = element.offsetHeight;

    // Determine max allowed positions based on canvas size and element size
    const maxLeft = renderedPageWidth - currentWidth;
    const maxTop = renderedPageHeight - currentHeight;

    // Constrain the relative position
    relativeX = Math.max(0, Math.min(relativeX, maxLeft));
    relativeY = Math.max(0, Math.min(relativeY, maxTop));

    // Also constrain size (in case resize made it larger than canvas)
    currentWidth = Math.min(currentWidth, renderedPageWidth);
    currentHeight = Math.min(currentHeight, renderedPageHeight);

    // Apply the constrained values back to the element's style
    // Using relative values ensures correct positioning against the canvas
    element.style.left = `${relativeX}px`;
    element.style.top = `${relativeY}px`;
    element.style.width = `${currentWidth}px`;
    element.style.height = `${currentHeight}px`;
}


/**
 * Adds the current placement of the active signature to the list.
 */
function addPlacement() {
    // Validate prerequisites
    if (!pdfDocProxy || !activeSignatureId || !currentCanvas || !signatureBox) {
        setStatus('Cannot add signature. PDF loaded, signature selected, and page rendered?', 'error', statusDiv);
        return;
    }

    // Calculate final position relative to the CANVAS using getBoundingClientRect
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
        pageNum: currentPageNum - 1, // 0-based index for backend
        x: finalX,
        y: finalY,
        widthPx: finalWidth,
        heightPx: finalHeight,
    };

    // Visually update the ACTIVE box to reflect potential constraint adjustments
    signatureBox.style.left = `${finalX}px`; signatureBox.style.top = `${finalY}px`;
    signatureBox.style.width = `${finalWidth}px`; signatureBox.style.height = `${finalHeight}px`;

    placedSignatures.push(placementData); // Add data to array

    renderSinglePersistentPlacement(placementData); // Create the persistent visual element
    renderPlacedSignaturesList(); // Update the text summary list
    setStatus(`Signature added to page ${currentPageNum}.`, 'success', statusDiv);
    updateButtonStates();

    // Optional: Deactivate signature after placing
    // setActiveSignature(null);
}

/**
 * Renders a single non-interactive div representing a placed signature.
 * @param {object} placementData - The data for the placement.
 */
function renderSinglePersistentPlacement(placementData) {
     if (!viewerContainer) return;
     const sigData = uploadedSignatures.find(s => s.id === placementData.signatureId);
     if (!sigData) return; // Need the signature data for the image src

     const placementDiv = document.createElement('div');
     placementDiv.className = 'persistent-placement absolute border border-gray-400 border-dashed z-5 pointer-events-none'; // Tailwind styles
     placementDiv.style.left = `${placementData.x}px`; placementDiv.style.top = `${placementData.y}px`;
     placementDiv.style.width = `${placementData.widthPx}px`; placementDiv.style.height = `${placementData.heightPx}px`;
     placementDiv.dataset.placementId = placementData.placementId; // Link visual element to data

     const placementImg = document.createElement('img');
     placementImg.src = sigData.dataUrl;
     placementImg.className = 'w-full h-full object-contain'; // Ensure image scales within div

     placementDiv.appendChild(placementImg);
     viewerContainer.appendChild(placementDiv); // Add to viewer
}

/**
 * Updates the text list that summarizes all placed signatures.
 */
function renderPlacedSignaturesList() {
    if (!placedSignaturesList) return;
    placedSignaturesList.innerHTML = ''; // Clear current list
    if (placedSignatures.length === 0) {
        placedSignaturesList.innerHTML = '<li class="text-gray-500 italic">No signatures added yet.</li>';
    } else {
        placedSignatures.forEach(p => {
            const sigInfo = uploadedSignatures.find(s => s.id === p.signatureId);
            const sigName = sigInfo ? (sigInfo.file?.name || 'Drawn Signature').substring(0, 15)+'...' : `ID: ${p.signatureId.substring(0, 8)}...`;

            const li = document.createElement('li');
            li.className = "flex justify-between items-center text-xs p-1 bg-gray-50 rounded"; // List item style

            const textSpan = document.createElement('span');
            textSpan.textContent = `Sig: ${sigName} on Page ${p.pageNum + 1}`; // Show 1-based page number
            li.appendChild(textSpan);

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.dataset.placementId = p.placementId; // Link button to placement ID
            removeBtn.className = "ml-2 px-1 py-0.5 text-red-600 border border-red-500 rounded text-[10px] hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-300"; // Remove button style
            li.appendChild(removeBtn);

            placedSignaturesList.appendChild(li);
        });
    }
     updateButtonStates(); // Update generate button availability
}

/**
 * Handles clicks on the "Remove" buttons in the placement summary list.
 * @param {Event} event - The click event.
 */
function handleRemovePlacement(event) {
    if (event.target.tagName === 'BUTTON' && event.target.dataset.placementId) {
        const placementIdToRemove = event.target.dataset.placementId;

        // Remove the visual element from the viewer
        if(viewerContainer) {
            const persistentElement = viewerContainer.querySelector(`.persistent-placement[data-placement-id="${placementIdToRemove}"]`);
            if (persistentElement) persistentElement.remove();
        }

        // Remove the data from the array
        placedSignatures = placedSignatures.filter(p => p.placementId !== placementIdToRemove);

        renderPlacedSignaturesList(); // Update the text list
        setStatus('Signature placement removed.', 'info', statusDiv);
        updateButtonStates();
    }
}

/**
 * Sends placement data and files to the Python backend for final PDF generation.
 */
function generateSignedPdf() {
    // Prerequisites check
    if (!pdfFile || placedSignatures.length === 0) { setStatus('Please load PDF and add signatures.', 'error', statusDiv); return; }
    if (renderedPageWidth <= 0 || renderedPageHeight <= 0) { setStatus('Error: Page dimensions not available.', 'error', statusDiv); return; }

    setStatus('Processing PDF on server...', 'loading', statusDiv);
    if(generateButton) generateButton.disabled = true;

    const formData = new FormData();
    formData.append('pdfFile', pdfFile); // Original PDF

    // Add unique signature files (both uploaded and drawn)
    const uniqueSignatureIds = [...new Set(placedSignatures.map(p => p.signatureId))];
    let filesIncludedCount = 0;
    uniqueSignatureIds.forEach(sigId => {
        const sigData = uploadedSignatures.find(s => s.id === sigId);
        if (sigData && sigData.file) { // Ensure file object exists
            // Key format expected by backend: 'signatureFiles[signatureId]'
            formData.append(`signatureFiles[${sigId}]`, sigData.file, sigData.file.name);
            filesIncludedCount++;
        } else {
             console.warn(`Signature file object not found for ID: ${sigId}. Skipping.`);
        }
    });

    // Abort if no valid signature files are found for the placements
     if (filesIncludedCount === 0 && placedSignatures.length > 0) {
         setStatus('Error: Could not find signature image files for placed items.', 'error', statusDiv);
         if(generateButton) generateButton.disabled = false;
         return;
     }

    // Add placement data and dimensions
    formData.append('placements', JSON.stringify(placedSignatures));
    formData.append('pageWidthPx', renderedPageWidth);
    formData.append('pageHeightPx', renderedPageHeight);

    // Send to backend
    fetch('/sign', { method: 'POST', body: formData })
        .then(response => {
            if (!response.ok) { // Handle HTTP errors
                return response.json().then(errData => { // Try to parse JSON error
                    throw new Error(errData.error?.message || `Server error: ${response.status}`);
                }).catch(() => { // Fallback if not JSON
                    throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`);
                });
            }
            return response.blob(); // Expect PDF blob on success
        })
        .then(blob => { // Success
            setStatus('Signed PDF ready for download.', 'success', statusDiv);
            // Trigger download
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none'; a.href = url;
            a.download = `${pdfFile.name.replace(/\.pdf$/i, '')}_signed.pdf`;
            document.body.appendChild(a); a.click();
            window.URL.revokeObjectURL(url); document.body.removeChild(a);
            // Re-enable button after slight delay
            setTimeout(() => { if(generateButton) generateButton.disabled = false; updateButtonStates(); }, 500);
        })
        .catch(error => { // Handle fetch or processing errors
            console.error('Signing error:', error);
            setStatus(`Signing failed: ${error.message}`, 'error', statusDiv);
            if(generateButton) generateButton.disabled = false;
            updateButtonStates();
        });
}

/** Handles file selection for the Convert Signature tab. */
function handleConvertSigFileSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        convertSigFile = file;
        if(convertButton) convertButton.disabled = false;
        // *** Use the correct convertStatusDiv variable ***
        setStatus('File selected. Click Convert.', 'info', convertStatusDiv);
        if(convertResultArea) convertResultArea.classList.add('hidden');
    } else {
        convertSigFile = null;
        if(convertButton) convertButton.disabled = true;
        // *** Use the correct convertStatusDiv variable ***
        setStatus('Please select a valid image file (PNG, JPG, GIF).', 'error', convertStatusDiv);
        if(convertResultArea) convertResultArea.classList.add('hidden');
    }
}

/** Sends signature file to backend for background removal. */
function handleConvertSignature() {
     if (!convertSigFile) {
         // *** Use the correct convertStatusDiv variable ***
         setStatus('No signature file selected for conversion.', 'error', convertStatusDiv);
         return;
     }
     // *** Use the correct convertStatusDiv variable ***
     setStatus('Converting signature...', 'loading', convertStatusDiv);
     if(convertButton) convertButton.disabled = true;
     if(convertResultArea) convertResultArea.classList.add('hidden');
     if (convertedBlobUrl) { URL.revokeObjectURL(convertedBlobUrl); convertedBlobUrl = null; }
     const formData = new FormData(); formData.append('signatureFile', convertSigFile);
     fetch('/convert_signature', { method: 'POST', body: formData })
         .then(response => { /* ... response handling ... */ })
         .then(blob => {
             convertedBlobUrl = URL.createObjectURL(blob);
             if(convertedSigPreview) convertedSigPreview.src = convertedBlobUrl;
             if(downloadConvertedLink) downloadConvertedLink.href = convertedBlobUrl;
             if(convertResultArea) convertResultArea.classList.remove('hidden');
              // *** Use the correct convertStatusDiv variable ***
             setStatus('Conversion successful. Preview shown below.', 'success', convertStatusDiv);
         })
         .catch(error => {
             console.error('Conversion error:', error);
              // *** Use the correct convertStatusDiv variable ***
             setStatus(`${error.message}`, 'error', convertStatusDiv);
             if(convertResultArea) convertResultArea.classList.add('hidden');
         })
         .finally(() => {
              if(!convertedBlobUrl && convertButton){ convertButton.disabled = false; }
         });
 }

// ==========================================================
// ========= INITIALIZATION & EVENT LISTENERS ===============
// ==========================================================

document.addEventListener('DOMContentLoaded', () => {

    console.log("DOM Loaded. Initializing script module...");

    // --- Assign global element variables ---
    let allElementsFound = true;
    try {
        tabButtons = document.querySelectorAll('.tab-button');
        tabContents = document.querySelectorAll('.tab-content');
        pdfFileInput = document.getElementById('pdf-upload');
        sigUploadArea = document.getElementById('signature-upload-area');
        sigDrawArea = document.getElementById('signature-draw-area');
        showUploadBtn = document.getElementById('show-upload-btn');
        showDrawBtn = document.getElementById('show-draw-btn');
        openDrawModalBtn = document.getElementById('open-draw-modal-btn');
        sigFileInput = document.getElementById('signature-upload');
        signatureGallery = document.getElementById('signature-gallery');
        viewerContainer = document.getElementById('viewer');
        signatureBox = document.getElementById('signatureBox');
        signatureImage = document.getElementById('signatureImage');
        prevPageButton = document.getElementById('prev-page');
        nextPageButton = document.getElementById('next-page');
        pageNumSpan = document.getElementById('page-num');
        pageCountSpan = document.getElementById('page-count');
        addSigButton = document.getElementById('add-signature-btn');
        generateButton = document.getElementById('generate-button');
        statusDiv = document.getElementById('status'); // <<<<< THE KEY ELEMENT
        placedSignaturesList = document.getElementById('placed-signatures-list');
        convertSigFileInput = document.getElementById('convert-sig-upload');
        convertButton = document.getElementById('convert-button');
        convertStatusDiv = document.getElementById('convert-status'); // <<<<< THE OTHER KEY ELEMENT
        convertResultArea = document.getElementById('convert-result-area');
        convertedSigPreview = document.getElementById('converted-sig-preview');
        downloadConvertedLink = document.getElementById('download-converted-link');
        signatureModal = document.getElementById('signature-modal');
        signaturePadCanvas = document.getElementById('signature-pad-canvas');
        clearSignatureBtn = document.getElementById('clear-signature-btn');
        saveSignatureBtn = document.getElementById('save-signature-btn');
        closeSignatureModalBtn = document.getElementById('close-signature-modal-btn');

        // *** Explicitly check the status divs ***
        if (!statusDiv) {
             console.error("FATAL: Main status element (#status) not found!");
             allElementsFound = false;
        }
        if (!convertStatusDiv) {
             console.error("FATAL: Convert status element (#convert-status) not found!");
             allElementsFound = false;
        }
        if (!allElementsFound) {
            alert("Critical UI elements could not be found. The page may not work correctly. Check console for details.");
            return; // Stop if essential status divs are missing
        }

    } catch (error) {
        console.error("Error finding DOM elements during initialization:", error);
        alert("An error occurred initializing the page UI.");
        return;
    }


    // --- Verify essential libraries ---
    if (typeof pdfjsLib === 'undefined') {
        console.error("FATAL: pdf.js (pdfjsLib) failed to load or execute before script!");
        setStatus("Error: PDF display library failed to load.", "error", statusDiv); // Use main statusDiv
        return;
    }
     if (typeof SignaturePad === 'undefined') {
        // This is only fatal if the user tries to draw
        console.warn("SignaturePad library not loaded! Drawing will not work.");
    }

    // --- Initial Setup Calls ---
    if(addSigButton) addSigButton.disabled = true;
    if(generateButton) generateButton.disabled = true;
    if(convertButton) convertButton.disabled = true;
    if(prevPageButton) prevPageButton.disabled = true;
    if(nextPageButton) nextPageButton.disabled = true;

    setupTabs();
    setupSignatureInputToggle();


    // --- Event Listeners (Attach only if element exists) ---
    // Using optional chaining (?.) for robustness
    pdfFileInput?.addEventListener('change', handlePdfUpload);
    sigFileInput?.addEventListener('change', handleSignatureUpload);
    signatureGallery?.addEventListener('click', handleGalleryClick);
    prevPageButton?.addEventListener('click', goToPrevPage);
    nextPageButton?.addEventListener('click', goToNextPage);
    signatureBox?.addEventListener('mousedown', startDragOrResize);
    document.addEventListener('mousemove', handleMouseMove); // Document listeners are safe
    document.addEventListener('mouseup', handleMouseUp);
    signatureImage?.addEventListener('dragstart', (e) => e.preventDefault());
    addSigButton?.addEventListener('click', addPlacement);
    generateButton?.addEventListener('click', generateSignedPdf);
    placedSignaturesList?.addEventListener('click', handleRemovePlacement);
    showUploadBtn?.addEventListener('click', showUploadMode);
    showDrawBtn?.addEventListener('click', showDrawMode);
    openDrawModalBtn?.addEventListener('click', openSignatureModal);
    closeSignatureModalBtn?.addEventListener('click', closeSignatureModal);
    clearSignatureBtn?.addEventListener('click', () => { if (signaturePad) signaturePad.clear(); });
    saveSignatureBtn?.addEventListener('click', saveDrawnSignature);
    convertSigFileInput?.addEventListener('change', handleConvertSigFileSelect);
    convertButton?.addEventListener('click', handleConvertSignature);
    window.addEventListener('resize', resizeCanvas);

    console.log("DOM fully loaded and script module initialized successfully.");

}); // End DOMContentLoaded listener
