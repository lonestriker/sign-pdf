// Access libraries loaded globally via script tags in HTML
const { PDFDocument, rgb, StandardFonts } = PDFLib; // Destructure from pdf-lib global
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

// --- State Variables ---
let pdfDocProxy = null; // PDF.js document proxy for rendering
let currentPageNum = 1;
let currentScale = 1.5;
let pdfFile = null; // The original PDF File object

let uploadedSignatures = []; // { id, file, dataUrl }
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

// Tailwind classes for status messages
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
signatureBox.addEventListener('mousedown', startDragOrResize);
document.addEventListener('mousemove', handleMouseMove);
document.addEventListener('mouseup', handleMouseUp);
signatureImage.addEventListener('dragstart', (e) => e.preventDefault());
addSigButton.addEventListener('click', addPlacement);
generateButton.addEventListener('click', generateSignedPdfClientSide); // Renamed function
placedSignaturesList.addEventListener('click', handleRemovePlacement);

// --- PDF Loading & Rendering (using PDF.js) ---

function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        pdfFile = file; // Store the File object
        const reader = new FileReader();
        reader.onload = function(e) {
            setStatus('Loading PDF...', 'loading');
            const loadingTask = pdfjsLib.getDocument({ data: e.target.result }); // Use global pdfjsLib
            loadingTask.promise.then(doc => {
                pdfDocProxy = doc; // Store the PDF.js document proxy
                pageCountSpan.textContent = pdfDocProxy.numPages;
                currentPageNum = 1;
                placedSignatures = [];
                renderPlacedSignaturesList();
                clearPersistentPlacements();
                renderPage(currentPageNum); // Initial render
                setStatus('PDF loaded. Upload signature(s).', 'success');
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
    clearPersistentPlacements();

    pdfDocProxy.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = "block mx-auto shadow-md";

        renderedPageWidth = viewport.width;
        renderedPageHeight = viewport.height;

        const persistentPlacements = viewerContainer.querySelectorAll('.persistent-placement');
        persistentPlacements.forEach(el => el.remove());
        const existingCanvas = viewerContainer.querySelector('canvas');
        if (existingCanvas) existingCanvas.remove();

        viewerContainer.insertBefore(canvas, signatureBox);
        currentCanvas = canvas;

        const renderContext = { canvasContext: context, viewport: viewport };
        page.render(renderContext).promise.then(() => {
            pageNumSpan.textContent = num;
            setStatus('Page rendered.', 'success');
            updatePageControls();
            renderPersistentPlacementsForPage(num - 1);
            if (activeSignatureId) {
                signatureBox.classList.remove('hidden');
                keepSignatureInBounds(signatureBox);
            }
        }).catch(err => handleRenderError(err, num));
    }).catch(err => handleRenderError(err, num));
}

// --- Signature Upload & Gallery ---

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
                dataUrl: e.target.result // For preview
            };
            uploadedSignatures.push(signatureData);
            renderSignatureGallery();
            setActiveSignature(signatureData.id);
            setStatus('Signature uploaded. Select from gallery to place.', 'success');
        }
        reader.readAsDataURL(file);
        event.target.value = null;
    } else {
        setStatus('Please select a valid image file.', 'error');
    }
    updateButtonStates();
}

// --- UI Interaction Functions (Mostly Unchanged) ---

function renderSignatureGallery() {
    signatureGallery.innerHTML = '';
    if (uploadedSignatures.length === 0) {
         signatureGallery.innerHTML = '<span class="text-xs text-gray-500 italic">Uploaded signatures will appear here. Click one to activate.</span>';
         return;
    }
    uploadedSignatures.forEach(sig => {
        const img = document.createElement('img');
        img.src = sig.dataUrl;
        img.alt = `Signature ${sig.file.name}`;
        img.dataset.signatureId = sig.id;
        img.className = `h-12 md:h-16 object-contain border-2 border-transparent rounded cursor-pointer hover:border-gray-400`;
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
        signatureBox.classList.remove('hidden');
        signatureBox.style.left = '10px';
        signatureBox.style.top = '10px';
        signatureBox.style.width = '150px';
        signatureBox.style.height = 'auto';
        requestAnimationFrame(() => {
            const imgHeight = signatureImage.offsetHeight;
            signatureBox.style.height = imgHeight > 10 ? `${imgHeight}px` : '75px';
            if (currentCanvas) keepSignatureInBounds(signatureBox);
        });
    } else {
        activeSignatureId = null;
        signatureImage.src = '#';
        signatureBox.classList.add('hidden');
    }
    renderSignatureGallery();
    updateButtonStates();
}

function handleRenderError(err, pageNum) {
     console.error(`Error rendering page ${pageNum}:`, err);
     setStatus(`Error rendering page ${pageNum}: ${err.message || err}`, 'error');
     updatePageControls();
}

function renderPersistentPlacementsForPage(pageNumZeroBased) {
     const placementsForPage = placedSignatures.filter(p => p.pageNum === pageNumZeroBased);
     placementsForPage.forEach(renderSinglePersistentPlacement);
}

function clearPersistentPlacements() {
     const persistentPlacements = viewerContainer.querySelectorAll('.persistent-placement');
     persistentPlacements.forEach(el => el.remove());
}

function updatePageControls() {
    if (!pdfDocProxy) return;
    prevPageButton.disabled = (currentPageNum <= 1);
    nextPageButton.disabled = (currentPageNum >= pdfDocProxy.numPages);
}

function goToPrevPage() {
    if (currentPageNum <= 1) return;
    currentPageNum--;
    renderPage(currentPageNum);
}

function goToNextPage() {
    if (!pdfDocProxy || currentPageNum >= pdfDocProxy.numPages) return;
    currentPageNum++;
    renderPage(currentPageNum);
}

function updateButtonStates() {
    addSigButton.disabled = !(pdfDocProxy && activeSignatureId && currentCanvas);
    generateButton.disabled = !(pdfDocProxy && placedSignatures.length > 0);
}

function resetPdfState() {
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
     updateButtonStates();
}

function setStatus(message, type = 'info') {
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
    const canvasRect = currentCanvas.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    let relativeX = elementRect.left - canvasRect.left; let relativeY = elementRect.top - canvasRect.top;
    let currentWidth = element.offsetWidth; let currentHeight = element.offsetHeight;
    const maxLeft = renderedPageWidth - currentWidth; const maxTop = renderedPageHeight - currentHeight;
    relativeX = Math.max(0, Math.min(relativeX, maxLeft)); relativeY = Math.max(0, Math.min(relativeY, maxTop));
    currentWidth = Math.min(currentWidth, renderedPageWidth); currentHeight = Math.min(currentHeight, renderedPageHeight);
    element.style.left = `${relativeX}px`; element.style.top = `${relativeY}px`;
    element.style.width = `${currentWidth}px`; element.style.height = `${currentHeight}px`;
}

// --- Placement Management (Mostly Unchanged Logic) ---

function addPlacement() {
    if (!pdfDocProxy || !activeSignatureId || !currentCanvas) {
        setStatus('Cannot add signature. PDF & signature must be loaded/selected.', 'error'); return;
    }
    const canvasRect = currentCanvas.getBoundingClientRect();
    const signatureRect = signatureBox.getBoundingClientRect();
    const relativeX = signatureRect.left - canvasRect.left;
    const relativeY = signatureRect.top - canvasRect.top;
    const sigWidth = signatureBox.offsetWidth;
    const sigHeight = signatureBox.offsetHeight;
    const finalX = Math.max(0, Math.min(relativeX, renderedPageWidth - sigWidth));
    const finalY = Math.max(0, Math.min(relativeY, renderedPageHeight - sigHeight));
    const finalWidth = Math.min(sigWidth, renderedPageWidth);
    const finalHeight = Math.min(sigHeight, renderedPageHeight);
    const placementData = {
        placementId: `place_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        signatureId: activeSignatureId, pageNum: currentPageNum - 1,
        x: finalX, y: finalY, widthPx: finalWidth, heightPx: finalHeight,
    };
    signatureBox.style.left = `${finalX}px`; signatureBox.style.top = `${finalY}px`;
    signatureBox.style.width = `${finalWidth}px`; signatureBox.style.height = `${finalHeight}px`;
    placedSignatures.push(placementData);
    renderSinglePersistentPlacement(placementData);
    renderPlacedSignaturesList();
    setStatus(`Signature added to page ${currentPageNum}. Add more or generate PDF.`, 'success');
    updateButtonStates();
}

function renderSinglePersistentPlacement(placementData) {
     const sigData = uploadedSignatures.find(s => s.id === placementData.signatureId);
     if (!sigData) return;
     const placementDiv = document.createElement('div');
     placementDiv.className = 'persistent-placement absolute border border-gray-400 border-dashed z-5 pointer-events-none';
     placementDiv.style.left = `${placementData.x}px`; placementDiv.style.top = `${placementData.y}px`;
     placementDiv.style.width = `${placementData.widthPx}px`; placementDiv.style.height = `${placementData.heightPx}px`;
     placementDiv.dataset.placementId = placementData.placementId;
     const placementImg = document.createElement('img');
     placementImg.src = sigData.dataUrl;
     placementImg.className = 'w-full h-full object-contain';
     placementDiv.appendChild(placementImg);
     viewerContainer.appendChild(placementDiv);
}

function renderPlacedSignaturesList() {
    placedSignaturesList.innerHTML = '';
    if (placedSignatures.length === 0) {
        placedSignaturesList.innerHTML = '<li class="text-gray-500 italic">No signatures added yet.</li>';
    } else {
        placedSignatures.forEach(p => {
            const sigInfo = uploadedSignatures.find(s => s.id === p.signatureId);
            const sigName = sigInfo ? sigInfo.file.name.substring(0, 15)+'...' : `ID: ${p.signatureId.substring(0, 8)}...`;
            const li = document.createElement('li');
            li.className = "flex justify-between items-center text-xs p-1 bg-gray-50 rounded";
            const textSpan = document.createElement('span');
            textSpan.textContent = `Sig: ${sigName} on Page ${p.pageNum + 1}`;
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


// --- *** NEW: Client-Side PDF Generation using pdf-lib.js *** ---

// Helper function to read a File object as an ArrayBuffer
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

async function generateSignedPdfClientSide() {
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
        // 1. Read the original PDF into an ArrayBuffer
        const pdfBytes = await readFileAsArrayBuffer(pdfFile);

        // 2. Load the PDF document with pdf-lib
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();

        // 3. Embed all unique required signatures
        const uniqueSignatureIds = [...new Set(placedSignatures.map(p => p.signatureId))];
        const embeddedSignatures = {}; // Store { signatureId: PDFImage }

        for (const sigId of uniqueSignatureIds) {
            const sigData = uploadedSignatures.find(s => s.id === sigId);
            if (!sigData) {
                throw new Error(`Signature data missing for ID: ${sigId}`);
            }

            const sigBytes = await readFileAsArrayBuffer(sigData.file);

            // *** IMPORTANT: Background Removal would happen here if implemented ***
            // e.g., pass sigBytes to a Pyodide/Wasm function or JS Canvas function
            // let processedSigBytes = await processImageBackground(sigBytes);
            // For now, we use the original bytes:
            let processedSigBytes = sigBytes;

            let embeddedImage;
            const fileType = sigData.file.type;

            if (fileType === 'image/png') {
                embeddedImage = await pdfDoc.embedPng(processedSigBytes);
            } else if (fileType === 'image/jpeg') {
                embeddedImage = await pdfDoc.embedJpg(processedSigBytes);
            } else if (fileType === 'image/gif') {
                 // pdf-lib doesn't directly embed GIF. Attempt conversion or warn.
                 // Simplest: Skip GIF or try embedding as JPG (might lose animation/transparency)
                 console.warn("GIF embedding not directly supported, attempting as JPG. Transparency/animation lost.");
                 try {
                     // This might require a helper library or more complex conversion
                     // For now, we'll try embedding directly, pdf-lib might handle basic cases or error out
                      embeddedImage = await pdfDoc.embedJpg(processedSigBytes); // Risky fallback
                 } catch (gifError){
                      throw new Error(`Failed to embed GIF signature '${sigData.file.name}'. Please use PNG or JPG.`);
                 }
            }
             else {
                throw new Error(`Unsupported signature image type: ${fileType}`);
            }
            embeddedSignatures[sigId] = embeddedImage;
        }

        // 4. Draw signatures onto pages
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

            // Calculate position and size in PDF points (using last known working logic)
            const scaleX = pageWidthPt / renderedPageWidth;
            const scaleY = pageHeightPt / renderedPageHeight;
            const sigWidthPt = placement.widthPx * scaleX;
            const sigHeightPt = placement.heightPx * scaleY;
            const yPtFromTop = placement.y * scaleY;
            const pdfY = pageHeightPt - yPtFromTop - sigHeightPt; // Bottom edge Y coordinate
            const pdfX = placement.x * scaleX; // Left edge X coordinate

            // Draw the image
            page.drawImage(embeddedImage, {
                x: pdfX,
                y: pdfY,
                width: sigWidthPt,
                height: sigHeightPt,
            });
        }

        // 5. Save the modified PDF document to bytes (Uint8Array)
        const modifiedPdfBytes = await pdfDoc.save();

        // 6. Trigger download
        const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `${pdfFile.name.replace(/\.pdf$/i, '')}_signed.pdf`; // Suggest a filename
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        setStatus('Signed PDF generated successfully!', 'success');

    } catch (error) {
        console.error('Error generating PDF client-side:', error);
        setStatus(`Error generating PDF: ${error.message || error}`, 'error');
    } finally {
        // Re-enable button after processing completes or fails
        generateButton.disabled = false;
        updateButtonStates();
    }
}