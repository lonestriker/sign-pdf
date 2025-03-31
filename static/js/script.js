// --- Import PDF.js Library ---
import * as pdfjsLib from './pdf.mjs';

// --- Set Worker Source ---
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

// --- Globals ---
const pdfFileInput = document.getElementById('pdf-upload');
const sigFileInput = document.getElementById('signature-upload');
const signatureGallery = document.getElementById('signature-gallery');
const viewerContainer = document.getElementById('viewer');
const signatureBox = document.getElementById('signatureBox'); // Container div
const signatureImage = document.getElementById('signatureImage'); // The actual img element
const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const pageNumSpan = document.getElementById('page-num');
const pageCountSpan = document.getElementById('page-count');
const addSigButton = document.getElementById('add-signature-btn');
const generateButton = document.getElementById('generate-button'); // Renamed
const statusDiv = document.getElementById('status');
const placedSignaturesList = document.getElementById('placed-signatures-list');

// --- State Variables ---
let pdfDoc = null;
let currentPageNum = 1;
let currentScale = 1.5;
let pdfFile = null; // Store the PDF File object

let uploadedSignatures = []; // Array to store { id: string, file: File, dataUrl: string }
let activeSignatureId = null; // ID of the signature currently selected from gallery
let placedSignatures = []; // Array to store placement data { placementId: string, signatureId: string, pageNum: number, x: number, y: number, widthPx: number, heightPx: number }

let isDragging = false;
let isResizing = false;
let resizeHandle = null; // Which handle is being dragged
let startX, startY, initialLeft, initialTop, initialWidth, initialHeight;
let renderedPageWidth = 0;
let renderedPageHeight = 0;
let currentCanvas = null;

// --- Initialization ---
updateButtonStates(); // Initial button state

// --- Event Listeners ---
pdfFileInput.addEventListener('change', handlePdfUpload);
sigFileInput.addEventListener('change', handleSignatureUpload); // Handles adding to gallery
signatureGallery.addEventListener('click', handleGalleryClick); // Select active signature
prevPageButton.addEventListener('click', goToPrevPage);
nextPageButton.addEventListener('click', goToNextPage);

// Dragging the entire box
signatureBox.addEventListener('mousedown', startDrag);

// Resizing using handles (delegate from the box)
signatureBox.addEventListener('mousedown', startResize);

// Mouse move and up listeners on the document to capture events outside the box/handles
document.addEventListener('mousemove', handleMouseMove);
document.addEventListener('mouseup', handleMouseUp);

// Prevent default image drag behavior
signatureImage.addEventListener('dragstart', (e) => e.preventDefault());

addSigButton.addEventListener('click', addPlacement);
generateButton.addEventListener('click', generateSignedPdf); // Renamed function
placedSignaturesList.addEventListener('click', handleRemovePlacement); // Remove placed signature


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
                // Reset placements if a new PDF is loaded? Or keep them? Let's reset for simplicity.
                placedSignatures = [];
                renderPlacedSignaturesList();
                renderPage(currentPageNum); // This now handles enabling controls too
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
                id: `sig_${Date.now()}_${Math.random().toString(16).slice(2)}`, // Unique ID
                file: file,
                dataUrl: e.target.result
            };
            uploadedSignatures.push(signatureData);
            renderSignatureGallery();
            // Optionally auto-select the newly uploaded signature
            setActiveSignature(signatureData.id);
            setStatus('Signature uploaded. Select from gallery to place.', 'success');
        }
        reader.readAsDataURL(file);
        // Clear the input value to allow uploading the same file again if needed
        event.target.value = null;
    } else {
        setStatus('Please select a valid image file (PNG, JPG, GIF).', 'error');
    }
    updateButtonStates();
}

function renderSignatureGallery() {
    signatureGallery.innerHTML = ''; // Clear existing
    uploadedSignatures.forEach(sig => {
        const img = document.createElement('img');
        img.src = sig.dataUrl;
        img.alt = `Signature ${sig.id}`;
        img.dataset.signatureId = sig.id; // Store ID for click handling
        if (sig.id === activeSignatureId) {
            img.classList.add('active-signature');
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
    if (activeSigData) {
        signatureImage.src = activeSigData.dataUrl;
        signatureBox.style.display = 'block'; // Show the draggable box
        // Reset position/size for the new signature? Optional, maybe keep last position.
        // Resetting position:
        signatureBox.style.left = '10px';
        signatureBox.style.top = '10px';
        // Resetting size (adjust as desired):
        signatureBox.style.width = '150px';
        signatureBox.style.height = 'auto'; // Let image determine initial height based on width
        // Ensure height adjusts correctly after src change if using auto:
        requestAnimationFrame(() => {
             signatureBox.style.height = `${signatureImage.offsetHeight}px`;
        });

    } else {
        activeSignatureId = null;
        signatureImage.src = '#';
        signatureBox.style.display = 'none'; // Hide box if no active signature
    }
    renderSignatureGallery(); // Update active highlight
    updateButtonStates();
}

function renderPage(num) {
    if (!pdfDoc) return;
    setStatus('Rendering page...', 'loading');
    signatureBox.style.display = 'none'; // Hide signature while rendering

    pdfDoc.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        renderedPageWidth = viewport.width;
        renderedPageHeight = viewport.height;

        viewerContainer.innerHTML = ''; // Clear previous content
        viewerContainer.appendChild(canvas);
        viewerContainer.appendChild(signatureBox); // Add signature box back (might be hidden)
        currentCanvas = canvas;

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        page.render(renderContext).promise.then(() => {
            pageNumSpan.textContent = num;
            setStatus('Page rendered.', 'success');
            updatePageControls();
            // Make signature box visible ONLY if an active signature is selected
            if (activeSignatureId) {
                signatureBox.style.display = 'block';
            }
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
}

function goToNextPage() {
    if (!pdfDoc || currentPageNum >= pdfDoc.numPages) return;
    currentPageNum++;
    renderPage(currentPageNum);
}

function updateButtonStates() {
    addSigButton.disabled = !(pdfDoc && activeSignatureId && currentCanvas);
    generateButton.disabled = !(pdfDoc && placedSignatures.length > 0);
}

function resetPdfState() {
     pdfDoc = null;
     currentPageNum = 1;
     pageNumSpan.textContent = '0';
     pageCountSpan.textContent = '0';
     viewerContainer.innerHTML = '';
     viewerContainer.appendChild(signatureBox); // Keep box in DOM structure
     signatureBox.style.display = 'none'; // But hide it
     updatePageControls();
     renderedPageWidth = 0;
     renderedPageHeight = 0;
     currentCanvas = null;
     pdfFile = null;
     placedSignatures = []; // Reset placements with PDF
     renderPlacedSignaturesList();
     updateButtonStates();
}

// Does NOT reset PDF state, only signature selection
function resetSignatureSelectionState() {
    activeSignatureId = null;
    signatureImage.src = '#';
    signatureBox.style.display = 'none';
    renderSignatureGallery(); // Remove highlight
    updateButtonStates();
}

function setStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = type;
}

// --- Drag and Resize Logic ---

function startDrag(e) {
    // Only drag if clicking on the box itself, not a resize handle
    if (e.target !== signatureBox && e.target !== signatureImage) return;
     // Prevent drag if no active signature or pdf not ready
    if (!activeSignatureId || !pdfDoc || !currentCanvas) return;

    isDragging = true;
    signatureBox.style.cursor = 'grabbing';
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = signatureBox.offsetLeft;
    initialTop = signatureBox.offsetTop;
    document.body.style.userSelect = 'none'; // Prevent text selection
}

function startResize(e) {
    // Check if the target is a resize handle
    if (!e.target.classList.contains('resize-handle')) return;
    // Prevent resize if no active signature or pdf not ready
    if (!activeSignatureId || !pdfDoc || !currentCanvas) return;

    isResizing = true;
    resizeHandle = e.target; // Store which handle is being dragged
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = signatureBox.offsetLeft;
    initialTop = signatureBox.offsetTop;
    initialWidth = signatureBox.offsetWidth;
    initialHeight = signatureBox.offsetHeight;
    document.body.style.userSelect = 'none';
    // console.log("Start Resize:", resizeHandle.className);
}

function handleMouseMove(e) {
    if (isDragging) {
        dragSignature(e);
    } else if (isResizing) {
        resizeSignature(e);
    }
}

function handleMouseUp() {
    if (isDragging) {
        isDragging = false;
        signatureBox.style.cursor = 'move';
        document.body.style.userSelect = '';
        // Ensure final position is within bounds
        keepSignatureInBounds();
    } else if (isResizing) {
        isResizing = false;
        resizeHandle = null;
        document.body.style.userSelect = '';
        // Ensure final position/size is within bounds
        keepSignatureInBounds();
    }
}

function dragSignature(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    signatureBox.style.left = `${newLeft}px`;
    signatureBox.style.top = `${newTop}px`;
    // Boundary check will happen on mouseup
}

function resizeSignature(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = initialLeft;
    let newTop = initialTop;
    let newWidth = initialWidth;
    let newHeight = initialHeight;

    // Calculate new dimensions/position based on handle
    if (resizeHandle.classList.contains('bottom-right')) {
        newWidth = initialWidth + dx;
        newHeight = initialHeight + dy;
    } else if (resizeHandle.classList.contains('bottom-left')) {
        newWidth = initialWidth - dx;
        newHeight = initialHeight + dy;
        newLeft = initialLeft + dx;
    } else if (resizeHandle.classList.contains('top-right')) {
        newWidth = initialWidth + dx;
        newHeight = initialHeight - dy;
        newTop = initialTop + dy;
    } else if (resizeHandle.classList.contains('top-left')) {
        newWidth = initialWidth - dx;
        newHeight = initialHeight - dy;
        newLeft = initialLeft + dx;
        newTop = initialTop + dy;
    }
    // Add logic for edge handles if implemented

    // Basic minimum size constraint
    const minSize = 20; // Minimum pixels wide/high
    if (newWidth < minSize) {
        if (resizeHandle.classList.contains('left')) newLeft = newLeft + newWidth - minSize; // Adjust left if shrinking from left
        newWidth = minSize;
    }
     if (newHeight < minSize) {
         if (resizeHandle.classList.contains('top')) newTop = newTop + newHeight - minSize; // Adjust top if shrinking from top
         newHeight = minSize;
     }


    // Update styles
    signatureBox.style.left = `${newLeft}px`;
    signatureBox.style.top = `${newTop}px`;
    signatureBox.style.width = `${newWidth}px`;
    signatureBox.style.height = `${newHeight}px`;

     // Boundary check will happen on mouseup
}

function keepSignatureInBounds() {
    if (!currentCanvas) return; // No canvas rendered yet

    const viewerRect = viewerContainer.getBoundingClientRect();
    let currentLeft = signatureBox.offsetLeft;
    let currentTop = signatureBox.offsetTop;
    let currentWidth = signatureBox.offsetWidth;
    let currentHeight = signatureBox.offsetHeight;

    // Ensure left edge >= 0
    if (currentLeft < 0) currentLeft = 0;
    // Ensure top edge >= 0
    if (currentTop < 0) currentTop = 0;
    // Ensure right edge <= viewer width
    if (currentLeft + currentWidth > viewerRect.width) {
        // Option 1: Shrink width
        // currentWidth = viewerRect.width - currentLeft;
        // Option 2: Move left edge
        currentLeft = viewerRect.width - currentWidth;
        if (currentLeft < 0) { // If it's now too wide, fix left and clamp width
             currentLeft = 0;
             currentWidth = viewerRect.width;
        }
    }
     // Ensure bottom edge <= viewer height
     if (currentTop + currentHeight > viewerRect.height) {
        // Option 1: Shrink height
        // currentHeight = viewerRect.height - currentTop;
        // Option 2: Move top edge
        currentTop = viewerRect.height - currentHeight;
        if (currentTop < 0) { // If it's now too tall, fix top and clamp height
             currentTop = 0;
             currentHeight = viewerRect.height;
        }
    }

    // Apply constrained values
    signatureBox.style.left = `${currentLeft}px`;
    signatureBox.style.top = `${currentTop}px`;
    signatureBox.style.width = `${currentWidth}px`;
    signatureBox.style.height = `${currentHeight}px`;
}

// --- Placement Management ---

function addPlacement() {
    if (!pdfDoc || !activeSignatureId || !currentCanvas) {
        setStatus('Cannot add signature. Ensure PDF is loaded and a signature is selected.', 'error');
        return;
    }

    keepSignatureInBounds(); // Ensure final values are valid before adding

    const placementData = {
        placementId: `place_${Date.now()}_${Math.random().toString(16).slice(2)}`, // Unique ID for this placement
        signatureId: activeSignatureId,
        pageNum: currentPageNum - 1, // 0-based index for backend
        x: signatureBox.offsetLeft,
        y: signatureBox.offsetTop,
        widthPx: signatureBox.offsetWidth,
        heightPx: signatureBox.offsetHeight,
    };

    placedSignatures.push(placementData);
    renderPlacedSignaturesList();
    setStatus(`Signature added to page ${currentPageNum}. Add more or generate PDF.`, 'success');
    updateButtonStates();

     // Optional: Hide or reset the active signature box after adding?
     // setActiveSignature(null); // This would hide it
}

function renderPlacedSignaturesList() {
    placedSignaturesList.innerHTML = ''; // Clear list
    if (placedSignatures.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No signatures added yet.';
        placedSignaturesList.appendChild(li);
    } else {
        placedSignatures.forEach(p => {
            const sigInfo = uploadedSignatures.find(s => s.id === p.signatureId);
            const sigName = sigInfo ? sigInfo.file.name.substring(0, 15)+'...' : `ID: ${p.signatureId.substring(0, 8)}...`;
            const li = document.createElement('li');
            li.textContent = `Sig: ${sigName} on Page ${p.pageNum + 1} (W: ${p.widthPx}px, H: ${p.heightPx}px)`;

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.dataset.placementId = p.placementId; // Link button to placement
            li.appendChild(removeBtn);

            placedSignaturesList.appendChild(li);
        });
    }
     updateButtonStates(); // Update generate button state
}

function handleRemovePlacement(event) {
    if (event.target.tagName === 'BUTTON' && event.target.dataset.placementId) {
        const placementIdToRemove = event.target.dataset.placementId;
        placedSignatures = placedSignatures.filter(p => p.placementId !== placementIdToRemove);
        renderPlacedSignaturesList();
        setStatus('Signature placement removed.', 'info');
    }
}

// --- Final PDF Generation ---

function generateSignedPdf() {
    if (!pdfFile || placedSignatures.length === 0) {
        setStatus('Please load a PDF and add at least one signature.', 'error');
        return;
    }
    if (renderedPageWidth <= 0 || renderedPageHeight <= 0) {
         setStatus('Error: Cannot determine page render dimensions. Please ensure a page is rendered.', 'error');
         return;
    }


    setStatus('Processing PDF...', 'loading');
    generateButton.disabled = true; // Prevent multiple clicks

    const formData = new FormData();

    // 1. Add PDF
    formData.append('pdfFile', pdfFile);

    // 2. Add Unique Signature Files used in placements
    const uniqueSignatureIds = [...new Set(placedSignatures.map(p => p.signatureId))];
    uniqueSignatureIds.forEach(sigId => {
        const sigData = uploadedSignatures.find(s => s.id === sigId);
        if (sigData) {
            // Key format expected by backend: 'signatureFiles[signatureId]'
            formData.append(`signatureFiles[${sigId}]`, sigData.file, sigData.file.name);
        } else {
             console.warn(`Could not find signature file data for ID: ${sigId}`);
             // Handle this potential error? Maybe alert user or skip?
        }
    });

    // 3. Add Placement Data as JSON string
    formData.append('placements', JSON.stringify(placedSignatures));

    // 4. Add Rendered Page Dimensions (used for scaling on backend)
    formData.append('pageWidthPx', renderedPageWidth);
    formData.append('pageHeightPx', renderedPageHeight);


    // --- Send to Backend ---
    fetch('/sign', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                throw new Error(errData.error?.message || `HTTP error! Status: ${response.status}`);
            }).catch(parseErr => {
                 throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`);
            });
        }
        return response.blob();
    })
    .then(blob => {
        setStatus('Signed PDF ready for download.', 'success');
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'signed_document.pdf';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        generateButton.disabled = false; // Re-enable button
        updateButtonStates(); // Ensure consistency
    })
    .catch(error => {
        console.error('Signing error:', error);
        setStatus(`Signing failed: ${error.message}`, 'error');
        generateButton.disabled = false; // Re-enable button
        updateButtonStates(); // Ensure consistency
    });
}