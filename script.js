// ==========================================
// 1. CONFIGURAÇÃO INICIAL
// ==========================================
const usinaLocation = [-17.6435490000631, -40.18241647057885]; 
const map = L.map('map', { doubleClickZoom: false }).setView(usinaLocation, 16);

L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{
    maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

// Variáveis Globais
let appState = 'IDLE'; 
let activeLinePoints = []; 
let activePolyline = null; 
let editMarkers = []; 
let editingId = null; 
let dbLines = []; 
let isSimulating = false;

loadFromStorage();

// ==========================================
// 2. MODOS DE OPERAÇÃO
// ==========================================

function setMode(mode) {
    if (appState === 'CREATING' || appState === 'EDITING') cancelAction();
    
    // Reseta botões
    document.querySelectorAll('button').forEach(b => {
        b.classList.remove('active', 'burst-mode', 'btn-save-edit');
        if(!b.classList.contains('action-btn') && !b.classList.contains('danger-btn')) {
            b.style.backgroundColor = '';
        }
    });

    const btnMain = document.getElementById('btn-main');
    const btnBurst = document.getElementById('btn-burst');

    if (mode === 'burst') {
        appState = 'BURSTING';
        btnBurst.classList.add('burst-mode');
        updateStatus('⚠️ MODO VAZAMENTO: Clique exatamente no local da quebra da tubulação.');
        map.getContainer().style.cursor = 'crosshair';
    } 
    else if (mode === 'create') {
        startCreation();
    }
    else {
        appState = 'IDLE';
        btnMain.innerHTML = '<i class="fa-solid fa-plus"></i> Nova Linha';
        updateStatus('Painel de Controle');
        map.getContainer().style.cursor = '';
    }
}

function handleMainButton() {
    if (appState === 'IDLE') setMode('create');
    else if (appState === 'CREATING') {
        if (activeLinePoints.length > 1) openModal();
        else cancelAction();
    } else if (appState === 'EDITING') {
        saveEditedLine();
    }
}

function startCreation() {
    appState = 'CREATING';
    activeLinePoints = [];
    activePolyline = null;
    updateUI('Clique no mapa para desenhar. Clique no botão "Concluir" para salvar.', 'finish');
    map.getContainer().style.cursor = 'crosshair';
}

// ==========================================
// 3. EVENTOS DO MAPA
// ==========================================

map.on('click', (e) => {
    if (appState === 'CREATING') {
        activeLinePoints.push(e.latlng);
        drawActivePolyline();
    } 
    else if (appState === 'EDITING') {
        activeLinePoints.push(e.latlng);
        drawActivePolyline();
        renderEditMarkers();
    }
    else if (appState === 'BURSTING') {
        handleBurstClick(e.latlng);
    }
});

map.on('dblclick', () => {
    if (appState === 'CREATING' && activeLinePoints.length > 1) openModal();
});

// ==========================================
// 4. LÓGICA DE VAZAMENTO (RAPIDEZ E ÍCONE)
// ==========================================

function handleBurstClick(clickLatLng) {
    // Procura a linha mais próxima matematicamente
    let closestLine = null;
    let minDistance = Infinity;
    let closestIndex = -1;

    dbLines.forEach(line => {
        line.points.forEach((pt, idx) => {
            const dist = map.distance(clickLatLng, pt);
            if (dist < minDistance) {
                minDistance = dist;
                closestLine = line;
                closestIndex = idx;
            }
        });
    });

    // Se clicou muito longe (mais de 40 metros)
    if (minDistance > 40 || !closestLine) {
        alert("Nenhuma tubulação detectada perto do clique.");
        return;
    }

    // Ação direta (confirm simples)
    if (confirm(`REPORTAR VAZAMENTO NA LINHA: ${closestLine.name}?`)) {
        closestLine.burst = {
            latlng: closestLine.points[closestIndex],
            index: closestIndex,
            active: true
        };
        saveToStorage();
        renderLineOnMap(closestLine);
        updateListHTML();
        setMode('IDLE');
        
        // Atualiza simulação visualmente
        if (isSimulating) {
            toggleSimulation();
            setTimeout(toggleSimulation, 50);
        }
    }
}

function repairLine(id) {
    const line = dbLines.find(l => l.id === id);
    if (line && confirm("O reparo foi concluído? O fluxo voltará ao normal.")) {
        line.burst = null;
        saveToStorage();
        renderLineOnMap(line);
        updateListHTML();
        if (isSimulating) { toggleSimulation(); setTimeout(toggleSimulation, 50); }
    }
}

// ==========================================
// 5. RENDERIZAÇÃO (COM ÍCONE ANIMADO)
// ==========================================

function renderLineOnMap(lineData) {
    if (lineData.layers) lineData.layers.forEach(l => map.removeLayer(l));
    lineData.layers = [];

    const baseColor = lineData.type === 'vinhaça' ? '#d946ef' : '#3b82f6';
    
    if (lineData.burst && lineData.burst.active) {
        // --- MODO VAZAMENTO ATIVO ---
        
        // 1. Parte Viva (até o vazamento)
        const activePoints = lineData.points.slice(0, lineData.burst.index + 1);
        const poly1 = L.polyline(activePoints, {
            color: '#64748b', weight: 5, className: `line-${lineData.id}-active`
        }).addTo(map);
        
        // 2. Parte Morta (pós vazamento)
        const deadPoints = lineData.points.slice(lineData.burst.index);
        const poly2 = L.polyline(deadPoints, {
            color: '#333', weight: 4, dashArray: '5, 10', opacity: 0.5
        }).addTo(map);

        // 3. ÍCONE ESPECIAL ANIMADO (CSS)
        const burstIcon = L.divIcon({
            className: 'leak-alert-wrapper', // Wrapper transparente
            html: '<div class="leak-alert-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20] // Centralizado
        });

        const burstMarker = L.marker(lineData.burst.latlng, { icon: burstIcon }).addTo(map);

        burstMarker.bindPopup(`
            <div style="text-align:center">
                <strong style="color:#ef4444; font-size:1.1em">🚨 VAZAMENTO CRÍTICO</strong><br>
                <span style="color:#ccc">${lineData.name}</span><br>
                <hr style="border-color:#444; margin:5px 0">
                <button onclick="repairLine(${lineData.id})" class="action-btn" style="width:100%; font-size:0.8rem">
                    <i class="fa-solid fa-wrench"></i> Concluir Reparo
                </button>
            </div>
        `);

        lineData.layers.push(poly1, poly2, burstMarker);

    } else {
        // --- LINHA NORMAL ---
        const poly = L.polyline(lineData.points, {
            color: '#64748b', weight: 5
        }).addTo(map);

        poly.bindPopup(`
            <div style="text-align:center;">
                <strong>${lineData.name}</strong><br>
                <small>${lineData.type.toUpperCase()}</small><br>
                <button onclick="startEditing(${lineData.id})" style="margin-top:5px; background:#f59e0b; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Editar Rota</button>
            </div>
        `);
        lineData.layers.push(poly);
    }
}

// ==========================================
// 6. EDIÇÃO, SALVAMENTO E AUXILIARES
// ==========================================

function startEditing(id) {
    if(appState !== 'IDLE') cancelAction();
    const lineData = dbLines.find(l => l.id === id);
    if(lineData.burst) { alert("Não é possível editar rota com vazamento ativo."); return; }

    appState = 'EDITING';
    editingId = id;
    activeLinePoints = [...lineData.points];
    
    if (lineData.layers) lineData.layers.forEach(l => map.removeLayer(l));
    drawActivePolyline();
    renderEditMarkers();
    updateUI('Arraste pontos para ajustar. Clique no mapa para estender.', 'save-edit');
}

function drawActivePolyline() {
    if (activePolyline) map.removeLayer(activePolyline);
    activePolyline = L.polyline(activeLinePoints, { color: '#facc15', dashArray: '10, 10', weight: 4 }).addTo(map);
}

function renderEditMarkers() {
    editMarkers.forEach(m => map.removeLayer(m));
    editMarkers = [];
    activeLinePoints.forEach((point, index) => {
        const marker = L.marker(point, {
            draggable: true,
            icon: L.divIcon({ className: 'edit-marker', iconSize: [12, 12], iconAnchor: [6, 6] })
        }).addTo(map);
        marker.on('drag', function(e) { activeLinePoints[index] = e.latlng; drawActivePolyline(); });
        marker.on('contextmenu', function() {
            if(activeLinePoints.length > 2) { activeLinePoints.splice(index, 1); drawActivePolyline(); renderEditMarkers(); }
        });
        editMarkers.push(marker);
    });
}

function openModal() { document.getElementById('modal-form').style.display = 'flex'; setTimeout(() => document.getElementById('input-name').focus(), 100); }
function closeModal() { document.getElementById('modal-form').style.display = 'none'; document.getElementById('input-name').value = ''; }

function saveNewData() {
    const name = document.getElementById('input-name').value;
    const type = document.getElementById('input-type').value;
    if(!name) { alert('Digite um nome!'); return; }
    
    const newLine = { id: Date.now(), name: name, type: type, points: activeLinePoints, layers: [], burst: null };
    dbLines.push(newLine);
    saveToStorage();
    if (activePolyline) map.removeLayer(activePolyline);
    renderLineOnMap(newLine);
    closeModal(); resetState(); updateListHTML();
}

function saveEditedLine() {
    const idx = dbLines.findIndex(l => l.id === editingId);
    if (idx > -1) {
        dbLines[idx].points = activeLinePoints;
        saveToStorage();
        if (activePolyline) map.removeLayer(activePolyline);
        editMarkers.forEach(m => map.removeLayer(m)); editMarkers = [];
        renderLineOnMap(dbLines[idx]);
        resetState();
    }
}

function cancelAction() {
    if (activePolyline) map.removeLayer(activePolyline);
    editMarkers.forEach(m => map.removeLayer(m)); editMarkers = [];
    if (appState === 'EDITING' && editingId) { const original = dbLines.find(l => l.id === editingId); if(original) renderLineOnMap(original); }
    closeModal(); resetState();
}

function resetState() {
    appState = 'IDLE'; activeLinePoints = []; activePolyline = null; editingId = null;
    map.getContainer().style.cursor = ''; updateUI('Painel de Controle', 'new');
}

function updateUI(text, type) {
    document.getElementById('status-msg').innerText = text;
    const btn = document.getElementById('btn-main');
    btn.classList.remove('active', 'btn-save-edit');
    if(type === 'new') btn.innerHTML = '<i class="fa-solid fa-plus"></i> Nova Linha';
    if(type === 'finish') { btn.innerHTML = '<i class="fa-solid fa-check"></i> Concluir'; btn.classList.add('active'); }
    if(type === 'save-edit') { btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar'; btn.classList.add('btn-save-edit'); }
}

function updateListHTML() {
    const container = document.getElementById('saved-list');
    container.innerHTML = '';
    if(dbLines.length === 0) { container.innerHTML = '<p style="text-align:center;color:#666">Vazio</p>'; return; }
    dbLines.forEach(line => {
        const hasBurst = line.burst && line.burst.active;
        const item = document.createElement('div');
        item.className = `saved-item ${hasBurst ? 'has-burst' : ''}`;
        item.innerHTML = `
            <div class="item-info" onclick="zoomToLine(${line.id})">
                <strong>${line.name}</strong><br>
                <small style="color:${line.type==='vinhaça'?'#d946ef':'#3b82f6'}">${line.type.toUpperCase()}</small>
                ${hasBurst ? '<br><small style="color:#ef4444; font-weight:bold"><i class="fa-solid fa-triangle-exclamation"></i> VAZAMENTO</small>' : ''}
            </div>
            <div class="item-actions">
                ${hasBurst ? 
                  `<button class="btn-icon btn-repair" onclick="repairLine(${line.id})" title="Reparar"><i class="fa-solid fa-wrench"></i></button>` : 
                  `<button class="btn-icon btn-edit" onclick="startEditing(${line.id})" title="Editar"><i class="fa-solid fa-pen"></i></button>`
                }
                <button class="btn-icon btn-del" onclick="deleteLine(${line.id})"><i class="fa-solid fa-times"></i></button>
            </div>`;
        container.appendChild(item);
    });
}

function saveToStorage() { localStorage.setItem('usina_sys_v5', JSON.stringify(dbLines.map(l => ({ id: l.id, name: l.name, type: l.type, points: l.points, burst: l.burst })))); }
function loadFromStorage() { const d = localStorage.getItem('usina_sys_v5'); if(d) { JSON.parse(d).forEach(l => { l.layers = []; dbLines.push(l); renderLineOnMap(l); }); updateListHTML(); } }
window.zoomToLine = function(id) { const l = dbLines.find(x => x.id === id); if(l && l.layers[0]) map.fitBounds(l.layers[0].getBounds()); }
window.deleteLine = function(id) { if(confirm('Excluir?')) { const i = dbLines.findIndex(x => x.id === id); if(i>-1) { dbLines[i].layers.forEach(x => map.removeLayer(x)); dbLines.splice(i,1); saveToStorage(); updateListHTML(); } } }
window.clearAllData = function() { if(confirm('Resetar tudo?')) { localStorage.removeItem('usina_sys_v5'); location.reload(); } }

window.toggleSimulation = function() {
    isSimulating = !isSimulating;
    const btn = document.getElementById('btn-simulate');
    if(isSimulating) {
        btn.innerHTML = '<i class="fa-solid fa-stop"></i> Parar'; btn.style.background = '#eab308';
        dbLines.forEach(line => {
            const activePoly = line.layers[0];
            const color = line.type === 'vinhaça' ? '#d946ef' : '#3b82f6';
            if(activePoly && activePoly instanceof L.Polyline) {
                activePoly.setStyle({ color: color, weight: 6, opacity: 1 });
                if(activePoly._path) activePoly._path.classList.add('vinasse-flow');
            }
        });
    } else {
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Simular Fluxo'; btn.style.background = '';
        dbLines.forEach(line => {
            const activePoly = line.layers[0];
            if(activePoly && activePoly instanceof L.Polyline) {
                activePoly.setStyle({ color: '#64748b', weight: 5 });
                if(activePoly._path) activePoly._path.classList.remove('vinasse-flow');
            }
        });
    }
}