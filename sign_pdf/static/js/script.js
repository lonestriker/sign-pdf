// --- Ensure PDF.js is loaded via module script in HTML ---
// Access pdfjsLib from the window object if necessary (or import if script.js is also a module)
// const pdfjsLib = window.pdfjsLib;

// --- Import PDF.js Library ---
import * as pdfjsLib from './pdf.mjs';

// --- Set Worker Source ---
// Use a relative path assuming pdf.mjs is in the same /static/js/ directory
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';


// --- Globals (DOM Elements) ---
// Tabs
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');
// Sign PDF Tab Elements
const pdfFileInput = document.getElementById('pdf-upload');
const sigFileInput = document.getElementById('signature-upload');
const signatureGallery = document.getElementById('signature-gallery');
const viewerContainer = document.getElementById('viewer');
const signatureBox = document.getElementById('signatureBox');
const signatureImage = document.getElementById('signatureImage');
const prevPageButton = document.getElementById('prev-page');
const nextPageButton = document.getElementById('next-page');
const pageNumSpan = document.getElementById('page-num');
const pageCountSpan = document.getElementById('page-count');
const addSigButton = document.getElementById('add-signature-btn');
const generateButton = document.getElementById('generate-button');
const statusDiv = document.getElementById('status'); // Status for Sign PDF
const placedSignaturesList = document.getElementById('placed-signatures-list');
// Convert Signature Tab Elements
const convertSigFileInput = document.getElementById('convert-sig-upload');
const convertButton = document.getElementById('convert-button');
const convertStatusDiv = document.getElementById('convert-status'); // Status for Convert Sig
const convertResultArea = document.getElementById('convert-result-area');
const convertedSigPreview = document.getElementById('converted-sig-preview');
const downloadConvertedLink = document.getElementById('download-converted-link');

// --- State Variables ---
// Sign PDF State
let pdfDocProxy = null;
let currentPageNum = 1;
let currentScale = 1.5;
let pdfFile = null;
let uploadedSignatures = [];
let activeSignatureId = null;
let placedSignatures = [];
let isDragging = false;
let isResizing = false;
let resizeHandle = null;
let startX, startY, initialLeft, initialTop, initialWidth, initialHeight;
let renderedPageWidth = 0;
let renderedPageHeight = 0;
let currentCanvas = null;
// Convert Signature State
let convertSigFile = null;
let convertedBlobUrl = null; // Store blob URL for download link

// Tailwind classes for status messages
const STATUS_CLASSES = {
    info: 'text-blue-600',
    loading: 'text-gray-600 animate-pulse',
    error: 'text-red-600 font-semibold',
    success: 'text-green-600'
};

// --- Initialization ---
updateButtonStates(); // Initial state for Sign PDF buttons
setupTabs(); // Setup tab switching

// --- Event Listeners ---
// Sign PDF Tab
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
generateButton.addEventListener('click', generateSignedPdf); // Backend version
placedSignaturesList.addEventListener('click', handleRemovePlacement);
// Convert Signature Tab
convertSigFileInput.addEventListener('change', handleConvertSigFileSelect);
convertButton.addEventListener('click', handleConvertSignature);


// --- Tab Switching Logic ---
function setupTabs() {
    // Show default active tab content
    document.querySelector('.tab-content.active')?.classList.remove('hidden');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            // Update button active states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Show/Hide content panes
            tabContents.forEach(content => {
                if (content.id === `tab-content-${targetTab}`) {
                    content.classList.remove('hidden'); // Or use 'block' if needed
                    content.classList.add('active');
                } else {
                    content.classList.add('hidden');
                    content.classList.remove('active');
                }
            });
        });
    });
}

// --- Sign PDF Functions (Mostly Unchanged from previous backend version) ---

function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        pdfFile = file;
        const reader = new FileReader();
        reader.onload = function(e) {
            setStatus('Loading PDF...', 'loading', statusDiv); // Target specific status div
            // Ensure pdfjsLib is available
            if (!window.pdfjsLib) {
                 setStatus('Error: PDF processing library not loaded.', 'error', statusDiv);
                 return;
            }
            const loadingTask = window.pdfjsLib.getDocument({ data: e.target.result });
            loadingTask.promise.then(doc => {
                pdfDocProxy = doc;
                pageCountSpan.textContent = pdfDocProxy.numPages;
                currentPageNum = 1;
                placedSignatures = [];
                renderPlacedSignaturesList();
                clearPersistentPlacements();
                renderPage(currentPageNum);
                setStatus('PDF loaded. Upload signature(s).', 'success', statusDiv);
            }).catch(err => {
                console.error("Error loading PDF:", err);
                setStatus(`Error loading PDF: ${err.message || err}`, 'error', statusDiv);
                resetPdfState();
            });
        };
        reader.readAsArrayBuffer(file);
    } else {
        setStatus('Please select a valid PDF file.', 'error', statusDiv);
        resetPdfState();
        pdfFile = null;
    }
    updateButtonStates();
}

function handleSignatureUpload(event) { // For Sign PDF tab
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const signatureData = {
                id: `sig_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                file: file, dataUrl: e.target.result
            };
            uploadedSignatures.push(signatureData);
            renderSignatureGallery();
            setActiveSignature(signatureData.id);
            setStatus('Signature uploaded. Select from gallery to place.', 'success', statusDiv);
        }
        reader.readAsDataURL(file);
        event.target.value = null;
    } else {
        setStatus('Please select a valid image file.', 'error', statusDiv);
    }
    updateButtonStates();
}

function renderPage(num) {
    if (!pdfDocProxy) return;
    setStatus('Rendering page...', 'loading', statusDiv);
    signatureBox.classList.add('hidden');
    clearPersistentPlacements();
    pdfDocProxy.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height; canvas.width = viewport.width;
        canvas.className = "block mx-auto shadow-md";
        renderedPageWidth = viewport.width; renderedPageHeight = viewport.height;
        const persistentPlacements = viewerContainer.querySelectorAll('.persistent-placement');
        persistentPlacements.forEach(el => el.remove());
        const existingCanvas = viewerContainer.querySelector('canvas');
        if (existingCanvas) existingCanvas.remove();
        viewerContainer.insertBefore(canvas, signatureBox);
        currentCanvas = canvas;
        const renderContext = { canvasContext: context, viewport: viewport };
        page.render(renderContext).promise.then(() => {
            pageNumSpan.textContent = num;
            setStatus('Page rendered.', 'success', statusDiv);
            updatePageControls();
            renderPersistentPlacementsForPage(num - 1);
            if (activeSignatureId) {
                signatureBox.classList.remove('hidden'); keepSignatureInBounds(signatureBox);
            }
        }).catch(err => handleRenderError(err, num));
    }).catch(err => handleRenderError(err, num));
}

function renderSignatureGallery() {
    signatureGallery.innerHTML = '';
    if (uploadedSignatures.length === 0) {
         signatureGallery.innerHTML = '<span class="text-xs text-gray-500 italic">Uploaded signatures will appear here.</span>'; return;
    }
    uploadedSignatures.forEach(sig => {
        const img = document.createElement('img');
        img.src = sig.dataUrl; img.alt = `Signature ${sig.file.name}`; img.dataset.signatureId = sig.id;
        img.className = `h-12 md:h-16 object-contain border-2 border-transparent rounded cursor-pointer hover:border-gray-400`;
        if (sig.id === activeSignatureId) img.classList.add('active-signature');
        signatureGallery.appendChild(img);
    });
}

function handleGalleryClick(event) {
    if (event.target.tagName === 'IMG' && event.target.dataset.signatureId) setActiveSignature(event.target.dataset.signatureId);
}

function setActiveSignature(signatureId) {
    activeSignatureId = signatureId;
    const activeSigData = uploadedSignatures.find(s => s.id === signatureId);
    if (activeSigData) {
        signatureImage.src = activeSigData.dataUrl;
        signatureBox.classList.remove('hidden');
        signatureBox.style.left = '10px'; signatureBox.style.top = '10px';
        signatureBox.style.width = '150px'; signatureBox.style.height = 'auto';
        requestAnimationFrame(() => {
            const imgHeight = signatureImage.offsetHeight;
            signatureBox.style.height = imgHeight > 10 ? `${imgHeight}px` : '75px';
            if (currentCanvas) keepSignatureInBounds(signatureBox);
        });
    } else {
        activeSignatureId = null; signatureImage.src = '#'; signatureBox.classList.add('hidden');
    }
    renderSignatureGallery(); updateButtonStates();
}

function handleRenderError(err, pageNum) {
     console.error(`Error rendering page ${pageNum}:`, err);
     setStatus(`Error rendering page ${pageNum}: ${err.message || err}`, 'error', statusDiv);
     updatePageControls();
}

function renderPersistentPlacementsForPage(pageNumZeroBased) {
     placedSignatures.filter(p => p.pageNum === pageNumZeroBased).forEach(renderSinglePersistentPlacement);
}

function clearPersistentPlacements() {
     viewerContainer.querySelectorAll('.persistent-placement').forEach(el => el.remove());
}

function updatePageControls() {
    if (!pdfDocProxy) return;
    prevPageButton.disabled = (currentPageNum <= 1);
    nextPageButton.disabled = (currentPageNum >= pdfDocProxy.numPages);
}

function goToPrevPage() { if (currentPageNum > 1) { currentPageNum--; renderPage(currentPageNum); } }
function goToNextPage() { if (pdfDocProxy && currentPageNum < pdfDocProxy.numPages) { currentPageNum++; renderPage(currentPageNum); } }

function updateButtonStates() {
    addSigButton.disabled = !(pdfDocProxy && activeSignatureId && currentCanvas);
    generateButton.disabled = !(pdfDocProxy && placedSignatures.length > 0);
    // Update convert button state separately
    convertButton.disabled = !convertSigFile;
}

function resetPdfState() {
     pdfDocProxy = null; currentPageNum = 1; pageNumSpan.textContent = '0'; pageCountSpan.textContent = '0';
     const existingCanvas = viewerContainer.querySelector('canvas'); if (existingCanvas) existingCanvas.remove();
     clearPersistentPlacements(); signatureBox.classList.add('hidden'); updatePageControls();
     renderedPageWidth = 0; renderedPageHeight = 0; currentCanvas = null; pdfFile = null;
     placedSignatures = []; renderPlacedSignaturesList(); updateButtonStates();
}

function setStatus(message, type = 'info', targetDiv) { // Added targetDiv parameter
    targetDiv.textContent = message;
    Object.values(STATUS_CLASSES).forEach(cls => targetDiv.classList.remove(...cls.split(' ')));
    if (STATUS_CLASSES[type]) targetDiv.classList.add(...STATUS_CLASSES[type].split(' '));
}

// Drag and Resize Logic (Identical to previous version)
function startDragOrResize(e) { if (!activeSignatureId || !pdfDocProxy || !currentCanvas) return; startX = e.clientX; startY = e.clientY; initialLeft = signatureBox.offsetLeft; initialTop = signatureBox.offsetTop; initialWidth = signatureBox.offsetWidth; initialHeight = signatureBox.offsetHeight; document.body.style.userSelect = 'none'; if (e.target.classList.contains('resize-handle')) { isResizing = true; resizeHandle = e.target; } else if (e.target === signatureBox || e.target === signatureImage) { isDragging = true; signatureBox.style.cursor = 'grabbing'; } }
function handleMouseMove(e) { if (!isDragging && !isResizing) return; e.preventDefault(); const dx = e.clientX - startX; const dy = e.clientY - startY; if (isDragging) dragSignature(dx, dy); else if (isResizing) resizeSignature(dx, dy); }
function handleMouseUp(e) { let wasActive = isDragging || isResizing; if (isDragging) { isDragging = false; signatureBox.style.cursor = 'move'; } if (isResizing) { isResizing = false; resizeHandle = null; } if (wasActive && currentCanvas) keepSignatureInBounds(signatureBox); document.body.style.userSelect = ''; }
function dragSignature(dx, dy) { let newLeft = initialLeft + dx; let newTop = initialTop + dy; signatureBox.style.left = `${newLeft}px`; signatureBox.style.top = `${newTop}px`; }
function resizeSignature(dx, dy) { let newLeft = initialLeft; let newTop = initialTop; let newWidth = initialWidth; let newHeight = initialHeight; const handleClassList = resizeHandle.classList; if (handleClassList.contains('cursor-nwse-resize')) { if (handleClassList.contains('-bottom-[6px]')) { newWidth = initialWidth + dx; newHeight = initialHeight + dy; } else { newWidth = initialWidth - dx; newHeight = initialHeight - dy; newLeft = initialLeft + dx; newTop = initialTop + dy; } } else if (handleClassList.contains('cursor-nesw-resize')) { if (handleClassList.contains('-bottom-[6px]')) { newWidth = initialWidth - dx; newHeight = initialHeight + dy; newLeft = initialLeft + dx; } else { newWidth = initialWidth + dx; newHeight = initialHeight - dy; newTop = initialTop + dy; } } const minSize = 20; if (newWidth < minSize) { newWidth = minSize; if (handleClassList.contains('-left-[6px]')) newLeft = initialLeft + initialWidth - minSize; } if (newHeight < minSize) { newHeight = minSize; if (handleClassList.contains('-top-[6px]')) newTop = initialTop + initialHeight - minSize; } signatureBox.style.left = `${newLeft}px`; signatureBox.style.top = `${newTop}px`; signatureBox.style.width = `${newWidth}px`; signatureBox.style.height = `${newHeight}px`; }
function keepSignatureInBounds(element) { if (!currentCanvas) return; const canvasRect = currentCanvas.getBoundingClientRect(); const elementRect = element.getBoundingClientRect(); let relativeX = elementRect.left - canvasRect.left; let relativeY = elementRect.top - canvasRect.top; let currentWidth = element.offsetWidth; let currentHeight = element.offsetHeight; const maxLeft = renderedPageWidth - currentWidth; const maxTop = renderedPageHeight - currentHeight; relativeX = Math.max(0, Math.min(relativeX, maxLeft)); relativeY = Math.max(0, Math.min(relativeY, maxTop)); currentWidth = Math.min(currentWidth, renderedPageWidth); currentHeight = Math.min(currentHeight, renderedPageHeight); element.style.left = `${relativeX}px`; element.style.top = `${relativeY}px`; element.style.width = `${currentWidth}px`; element.style.height = `${currentHeight}px`; }

// Placement Management (Identical logic, uses Sign PDF statusDiv)
function addPlacement() { if (!pdfDocProxy || !activeSignatureId || !currentCanvas) { setStatus('Cannot add signature. PDF & signature must be loaded/selected.', 'error', statusDiv); return; } const canvasRect = currentCanvas.getBoundingClientRect(); const signatureRect = signatureBox.getBoundingClientRect(); const relativeX = signatureRect.left - canvasRect.left; const relativeY = signatureRect.top - canvasRect.top; const sigWidth = signatureBox.offsetWidth; const sigHeight = signatureBox.offsetHeight; const finalX = Math.max(0, Math.min(relativeX, renderedPageWidth - sigWidth)); const finalY = Math.max(0, Math.min(relativeY, renderedPageHeight - sigHeight)); const finalWidth = Math.min(sigWidth, renderedPageWidth); const finalHeight = Math.min(sigHeight, renderedPageHeight); const placementData = { placementId: `place_${Date.now()}_${Math.random().toString(16).slice(2)}`, signatureId: activeSignatureId, pageNum: currentPageNum - 1, x: finalX, y: finalY, widthPx: finalWidth, heightPx: finalHeight }; signatureBox.style.left = `${finalX}px`; signatureBox.style.top = `${finalY}px`; signatureBox.style.width = `${finalWidth}px`; signatureBox.style.height = `${finalHeight}px`; placedSignatures.push(placementData); renderSinglePersistentPlacement(placementData); renderPlacedSignaturesList(); setStatus(`Signature added to page ${currentPageNum}.`, 'success', statusDiv); updateButtonStates(); }
function renderSinglePersistentPlacement(placementData) { const sigData = uploadedSignatures.find(s => s.id === placementData.signatureId); if (!sigData) return; const placementDiv = document.createElement('div'); placementDiv.className = 'persistent-placement absolute border border-gray-400 border-dashed z-5 pointer-events-none'; placementDiv.style.left = `${placementData.x}px`; placementDiv.style.top = `${placementData.y}px`; placementDiv.style.width = `${placementData.widthPx}px`; placementDiv.style.height = `${placementData.heightPx}px`; placementDiv.dataset.placementId = placementData.placementId; const placementImg = document.createElement('img'); placementImg.src = sigData.dataUrl; placementImg.className = 'w-full h-full object-contain'; placementDiv.appendChild(placementImg); viewerContainer.appendChild(placementDiv); }
function renderPlacedSignaturesList() { placedSignaturesList.innerHTML = ''; if (placedSignatures.length === 0) { placedSignaturesList.innerHTML = '<li class="text-gray-500 italic">No signatures added yet.</li>'; } else { placedSignatures.forEach(p => { const sigInfo = uploadedSignatures.find(s => s.id === p.signatureId); const sigName = sigInfo ? sigInfo.file.name.substring(0, 15)+'...' : `ID: ${p.signatureId.substring(0, 8)}...`; const li = document.createElement('li'); li.className = "flex justify-between items-center text-xs p-1 bg-gray-50 rounded"; const textSpan = document.createElement('span'); textSpan.textContent = `Sig: ${sigName} on Page ${p.pageNum + 1}`; li.appendChild(textSpan); const removeBtn = document.createElement('button'); removeBtn.textContent = 'Remove'; removeBtn.dataset.placementId = p.placementId; removeBtn.className = "ml-2 px-1 py-0.5 text-red-600 border border-red-500 rounded text-[10px] hover:bg-red-50 focus:outline-none focus:ring-1 focus:ring-red-300"; li.appendChild(removeBtn); placedSignaturesList.appendChild(li); }); } updateButtonStates(); }
function handleRemovePlacement(event) { if (event.target.tagName === 'BUTTON' && event.target.dataset.placementId) { const placementIdToRemove = event.target.dataset.placementId; const persistentElement = viewerContainer.querySelector(`.persistent-placement[data-placement-id="${placementIdToRemove}"]`); if (persistentElement) persistentElement.remove(); placedSignatures = placedSignatures.filter(p => p.placementId !== placementIdToRemove); renderPlacedSignaturesList(); setStatus('Signature placement removed.', 'info', statusDiv); updateButtonStates(); } }

// Final PDF Generation (Backend Version - Identical logic to previous version)
function generateSignedPdf() { if (!pdfFile || placedSignatures.length === 0) { setStatus('Please load PDF and add signatures.', 'error', statusDiv); return; } if (renderedPageWidth <= 0 || renderedPageHeight <= 0) { setStatus('Error: Page dimensions not available.', 'error', statusDiv); return; } setStatus('Processing PDF...', 'loading', statusDiv); generateButton.disabled = true; const formData = new FormData(); formData.append('pdfFile', pdfFile); const uniqueSignatureIds = [...new Set(placedSignatures.map(p => p.signatureId))]; let filesIncludedCount = 0; uniqueSignatureIds.forEach(sigId => { const sigData = uploadedSignatures.find(s => s.id === sigId); if (sigData) { formData.append(`signatureFiles[${sigId}]`, sigData.file, sigData.file.name); filesIncludedCount++; } else { console.warn(`Sig file data not found for ID: ${sigId}`); } }); if (filesIncludedCount === 0 && placedSignatures.length > 0) { setStatus('Error: Could not find signature files for placed items.', 'error', statusDiv); generateButton.disabled = false; return; } formData.append('placements', JSON.stringify(placedSignatures)); formData.append('pageWidthPx', renderedPageWidth); formData.append('pageHeightPx', renderedPageHeight); fetch('/sign', { method: 'POST', body: formData }).then(response => { if (!response.ok) { return response.json().then(errData => { throw new Error(errData.error?.message || `Server error: ${response.status}`); }).catch(() => { throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`); }); } return response.blob(); }).then(blob => { setStatus('Signed PDF ready for download.', 'success', statusDiv); const url = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.style.display = 'none'; a.href = url; a.download = `${pdfFile.name.replace(/\.pdf$/i, '')}_signed.pdf`; document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url); document.body.removeChild(a); setTimeout(() => { generateButton.disabled = false; updateButtonStates(); }, 500); }).catch(error => { console.error('Signing error:', error); setStatus(`Signing failed: ${error.message}`, 'error', statusDiv); generateButton.disabled = false; updateButtonStates(); }); }


// --- NEW: Convert Signature Functions ---

function handleConvertSigFileSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        convertSigFile = file;
        convertButton.disabled = false;
        setStatus('File selected. Click Convert.', 'info', convertStatusDiv);
        convertResultArea.classList.add('hidden'); // Hide old result
    } else {
        convertSigFile = null;
        convertButton.disabled = true;
        setStatus('Please select a valid image file (PNG, JPG, GIF).', 'error', convertStatusDiv);
        convertResultArea.classList.add('hidden');
    }
}

function handleConvertSignature() {
    if (!convertSigFile) {
        setStatus('No signature file selected for conversion.', 'error', convertStatusDiv);
        return;
    }

    setStatus('Converting signature...', 'loading', convertStatusDiv);
    convertButton.disabled = true;
    convertResultArea.classList.add('hidden'); // Hide previous result during processing

    // Clean up previous blob URL if it exists
    if (convertedBlobUrl) {
        URL.revokeObjectURL(convertedBlobUrl);
        convertedBlobUrl = null;
    }

    const formData = new FormData();
    formData.append('signatureFile', convertSigFile);

    fetch('/convert_signature', { // Target the new backend endpoint
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            // Try to get error message from backend JSON response
            return response.json().then(errData => {
                 throw new Error(errData.error?.message || `Conversion failed: ${response.status}`);
            }).catch(() => {
                 // Fallback if response is not JSON
                 throw new Error(`Conversion failed: ${response.status} ${response.statusText}`);
            });
        }
        // Expecting image blob on success
        return response.blob();
    })
    .then(blob => {
        // Create a URL for the resulting blob
        convertedBlobUrl = URL.createObjectURL(blob);

        // Display the preview
        convertedSigPreview.src = convertedBlobUrl;
        downloadConvertedLink.href = convertedBlobUrl; // Set download link href
        convertResultArea.classList.remove('hidden'); // Show the result area
        setStatus('Conversion successful. Preview shown below.', 'success', convertStatusDiv);
    })
    .catch(error => {
        console.error('Conversion error:', error);
        setStatus(`${error.message}`, 'error', convertStatusDiv); // Show specific error
        convertResultArea.classList.add('hidden');
    })
    .finally(() => {
        // Re-enable button unless it was successful (user should download first)
         if(!convertedBlobUrl){ // Re-enable only if there wasn't a success/blob created
              convertButton.disabled = false;
         }
        // Consider re-enabling after download click? For now, user has to select file again to re-enable.
    });
}