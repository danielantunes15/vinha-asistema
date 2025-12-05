// ==========================================
// 1. CONFIGURAÇÃO INICIAL E VARIÁVEIS
// ==========================================
const usinaLocation = [-17.6435490000631, -40.18241647057885]; 
const map = L.map('map', { 
    zoomControl: false, // Vamos usar controles personalizados se precisar
    attributionControl: false,
    doubleClickZoom: false // CORREÇÃO: Impede zoom no duplo clique para permitir finalizar linhas
}).setView(usinaLocation, 16);

// Camada de Satélite Google
L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{
    maxZoom: 21, 
    subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

// Variáveis de Estado
let appState = 'IDLE'; // Estados: IDLE, CREATING, BURSTING
let systemActive = false; // Estado do botão Master (ON/OFF)
let dbLines = []; 

// Variáveis de Edição/Criação
let activeLinePoints = []; 
let activePolyline = null; 
let editMarkers = []; 

// Inicialização
loadFromStorage();
showToast("Sistema carregado. Pronto para operação.");

// ==========================================
// 2. LÓGICA DO PAINEL DE CONTROLE (NOVO)
// ==========================================

// Alternar o botão Master (Ligar/Desligar Usina)
function toggleSystemPower() {
    systemActive = !systemActive;
    const btn = document.getElementById('btn-master-start');
    const badge = document.getElementById('sys-status-badge');
    const label = document.getElementById('btn-master-label');
    
    if (systemActive) {
        // LIGAR
        btn.classList.add('active');
        label.innerText = "PARAR PRESSURIZAÇÃO";
        badge.innerText = "ONLINE - BOMBAS ATIVAS";
        badge.className = "badge badge-online";
        showToast("Iniciando bombas... Pressurizando rede.");
        
        // Ativar visualização de fluxo no mapa
        dbLines.forEach(line => {
            if(!line.burst) animateLineFlow(line, true);
        });
    } else {
        // DESLIGAR
        btn.classList.remove('active');
        label.innerText = "INICIAR PRESSURIZAÇÃO";
        badge.innerText = "OFFLINE";
        badge.className = "badge badge-offline";
        showToast("Desligando sistema. Fluxo interrompido.");
        
        // Parar visualização
        dbLines.forEach(line => animateLineFlow(line, false));
    }
    
    // Atualiza todos os manômetros e cards
    updateDashboard();
}

// Atualiza o Dashboard Lateral (HTML dos Cards)
function updateDashboard() {
    const list = document.getElementById('lines-dashboard-list');
    list.innerHTML = '';
    
    let totalLines = dbLines.length;
    let totalLeaks = 0;
    let totalPressureSum = 0;
    let activeCount = 0;
    
    if(totalLines === 0) {
        list.innerHTML = '<p class="empty-msg">Nenhuma linha cadastrada.<br>Clique em "Nova Linha" para começar.</p>';
        updateStats(0, 0, 0);
        return;
    }

    dbLines.forEach(line => {
        const hasBurst = line.burst && line.burst.active;
        if(hasBurst) totalLeaks++;
        
        // Simulação de Pressão
        let displayPressure = 0;
        let pressureWidth = 0;
        
        if (systemActive) {
            // Se tiver vazamento, pressão cai drasticamente para 1.2
            // Se normal, sobe até a pressão nominal configurada
            displayPressure = hasBurst ? 1.2 : (line.nominalPressure || 4.0);
            
            if(!hasBurst) {
                totalPressureSum += displayPressure;
                activeCount++;
            }
            
            // Calcula % da barra (Baseado em máx 10kgf para visualização)
            pressureWidth = (displayPressure / 10) * 100; 
            if(pressureWidth > 100) pressureWidth = 100;
        }

        const distanceKm = calculateTotalDistance(line.points);

        const el = document.createElement('div');
        el.className = `line-card ${line.type} ${hasBurst ? 'leak' : ''}`;
        el.onclick = (e) => {
            // Se clicar no card, foca no mapa, a menos que clique num botão
            if(e.target.tagName !== 'BUTTON' && e.target.tagName !== 'I') zoomToLine(line.id);
        };
        
        el.innerHTML = `
            <div class="card-top">
                <div>
                    <span class="line-name">${line.name}</span>
                    <span class="line-meta">${distanceKm} • ${line.type.toUpperCase()}</span>
                </div>
                <span class="line-status">
                    ${hasBurst ? 'CRÍTICO' : (systemActive ? 'ATIVO' : 'STANDBY')}
                </span>
            </div>
            
            <div class="pressure-wrapper">
                <div class="pressure-info">
                    <span>Pressão Monitorada</span>
                    <span><strong>${displayPressure.toFixed(1)}</strong> kgf/cm²</span>
                </div>
                <div class="pressure-bar-bg">
                    <div class="pressure-fill" style="width: ${pressureWidth}%"></div>
                </div>
            </div>

            <div class="card-actions">
                 ${hasBurst ? 
                  `<button class="btn-card btn-repair" onclick="repairLine(${line.id}, event)"><i class="fa-solid fa-wrench"></i> Reparar</button>` : 
                  `<button class="btn-card btn-del" onclick="deleteLine(${line.id}, event)"><i class="fa-solid fa-trash"></i></button>`
                }
            </div>
        `;
        list.appendChild(el);
    });

    // Média de pressão apenas das linhas ativas e sem vazamento
    const avgP = activeCount > 0 ? (totalPressureSum / activeCount).toFixed(1) : "0.0";
    updateStats(totalLines, totalLeaks, avgP);
}

function updateStats(lines, leaks, pressure) {
    document.getElementById('count-lines').innerText = lines;
    document.getElementById('count-leaks').innerText = leaks;
    document.getElementById('avg-pressure').innerHTML = `${pressure} <small>kgf</small>`;
}

// Calcula Distância em KM
function calculateTotalDistance(points) {
    let totalDistance = 0;
    for (let i = 0; i < points.length - 1; i++) {
        totalDistance += map.distance(points[i], points[i+1]);
    }
    const km = totalDistance / 1000;
    if(km < 1) return Math.round(totalDistance) + ' m';
    return km.toFixed(2) + ' km';
}

// ==========================================
// 3. MODOS DE INTERAÇÃO (Criar, Vazamento)
// ==========================================

function setMode(mode) {
    // Limpa estados anteriores
    if (appState === 'CREATING') cancelAction();
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active', 'burst-mode'));

    if (mode === 'burst') {
        appState = 'BURSTING';
        document.querySelector('.tool-btn.danger').classList.add('active', 'burst-mode');
        showToast("⚠️ MODO ALERTA: Clique na tubulação onde há vazamento.");
        map.getContainer().style.cursor = 'crosshair';
    } 
    else if (mode === 'create') {
        appState = 'CREATING';
        activeLinePoints = [];
        activePolyline = null;
        showToast("MODO DESENHO: Clique no mapa para traçar a rota.");
        map.getContainer().style.cursor = 'crosshair';
    }
    else {
        appState = 'IDLE';
        map.getContainer().style.cursor = '';
    }
}

// ==========================================
// 4. EVENTOS DO MAPA
// ==========================================

map.on('click', (e) => {
    if (appState === 'CREATING') {
        activeLinePoints.push(e.latlng);
        drawActivePolyline();
    } 
    else if (appState === 'BURSTING') {
        handleBurstClick(e.latlng);
    }
});

// Finaliza criação ao clicar duas vezes no mapa
map.on('dblclick', () => {
    if (appState === 'CREATING' && activeLinePoints.length > 1) {
        document.getElementById('modal-form').style.display = 'flex';
        document.getElementById('input-name').focus();
    }
});

// Desenha a linha amarela tracejada durante a criação
function drawActivePolyline() {
    if (activePolyline) map.removeLayer(activePolyline);
    activePolyline = L.polyline(activeLinePoints, { 
        color: '#facc15', 
        dashArray: '10, 10', 
        weight: 4 
    }).addTo(map);
}

// ==========================================
// 5. LÓGICA DE VAZAMENTO (BURST)
// ==========================================

function handleBurstClick(clickLatLng) {
    // Encontrar linha mais próxima
    let closestLine = null;
    let minDistance = Infinity;
    let closestIndex = -1;

    dbLines.forEach(line => {
        if(line.burst) return; // Se já tem vazamento, ignora
        line.points.forEach((pt, idx) => {
            const dist = map.distance(clickLatLng, pt);
            if (dist < minDistance) {
                minDistance = dist;
                closestLine = line;
                closestIndex = idx;
            }
        });
    });

    if (minDistance > 50 || !closestLine) {
        showToast("Nenhuma tubulação detectada neste ponto.");
        return;
    }

    if (confirm(`REPORTAR VAZAMENTO NA LINHA: ${closestLine.name}?`)) {
        closestLine.burst = {
            latlng: closestLine.points[closestIndex],
            index: closestIndex,
            active: true
        };
        saveToStorage();
        renderLineOnMap(closestLine);
        
        // Se sistema ligado, atualiza o visual
        if(systemActive) {
            // Pequeno delay para efeito visual
            setTimeout(() => animateLineFlow(closestLine, true), 100);
        }
        
        setMode('IDLE'); // Sai do modo vazamento
        updateDashboard();
        showToast("🚨 Vazamento registrado! Queda de pressão detectada.");
    }
}

// ==========================================
// 6. RENDERIZAÇÃO NO MAPA
// ==========================================

function renderLineOnMap(lineData) {
    // Remove camadas antigas desta linha
    if (lineData.layers) lineData.layers.forEach(l => map.removeLayer(l));
    lineData.layers = [];

    // Cores base
    const baseColor = lineData.type === 'vinhaça' ? '#d946ef' : '#3b82f6';
    
    if (lineData.burst && lineData.burst.active) {
        // --- COM VAZAMENTO ---
        
        // 1. Parte "Viva" (até o vazamento)
        const activePoints = lineData.points.slice(0, lineData.burst.index + 1);
        const poly1 = L.polyline(activePoints, {
            color: '#64748b', weight: 5, opacity: 0.8
        }).addTo(map);
        
        // 2. Parte "Morta" (pós vazamento - sem fluxo)
        const deadPoints = lineData.points.slice(lineData.burst.index);
        const poly2 = L.polyline(deadPoints, {
            color: '#333', weight: 4, dashArray: '5, 10', opacity: 0.4
        }).addTo(map);

        // 3. Ícone de Alerta Animado
        const burstIcon = L.divIcon({
            className: 'leak-alert-wrapper',
            html: '<div class="leak-alert-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
        const burstMarker = L.marker(lineData.burst.latlng, { icon: burstIcon }).addTo(map);

        lineData.layers.push(poly1, poly2, burstMarker);

    } else {
        // --- LINHA NORMAL ---
        const poly = L.polyline(lineData.points, {
            color: '#64748b', // Cinza por padrão (Off)
            weight: 5,
            opacity: 0.7
        }).addTo(map);

        // Popup simples ao clicar na linha
        poly.bindPopup(`<b>${lineData.name}</b><br>Pressão Nominal: ${lineData.nominalPressure || 4} kgf`);
        
        lineData.layers.push(poly);
    }
}

// Animação de Fluxo (chamada pelo botão Master)
function animateLineFlow(line, active) {
    // A camada principal é sempre a primeira (layers[0])
    // Se tiver vazamento, layers[0] é o segmento até o vazamento
    const poly = line.layers[0]; 
    if(!poly || !(poly instanceof L.Polyline)) return;
    
    const color = line.type === 'vinhaça' ? '#d946ef' : '#3b82f6'; // Roxo ou Azul

    if (active) {
        // Ativa cor e animação CSS
        poly.setStyle({ color: color, weight: 6, opacity: 1 });
        if(poly._path) poly._path.classList.add('vinasse-flow');
    } else {
        // Volta para cinza
        poly.setStyle({ color: '#64748b', weight: 5, opacity: 0.7 });
        if(poly._path) poly._path.classList.remove('vinasse-flow');
    }
}

// ==========================================
// 7. FUNÇÕES AUXILIARES (Salvar, Deletar, Zoom)
// ==========================================

function saveNewData() {
    const name = document.getElementById('input-name').value;
    const type = document.getElementById('input-type').value;
    const press = parseFloat(document.getElementById('input-pressure').value) || 4.0;
    
    if(!name) { alert('Digite um nome!'); return; }
    
    const newLine = { 
        id: Date.now(), 
        name: name, 
        type: type, 
        nominalPressure: press,
        points: activeLinePoints, 
        layers: [], 
        burst: null 
    };
    
    dbLines.push(newLine);
    saveToStorage();
    
    if (activePolyline) map.removeLayer(activePolyline);
    renderLineOnMap(newLine);
    
    // Se sistema estiver ligado, já anima a nova linha
    if(systemActive) animateLineFlow(newLine, true);

    cancelAction(); // Fecha modal e limpa
    updateDashboard();
    showToast("Nova linha cadastrada com sucesso.");
}

function cancelAction() {
    document.getElementById('modal-form').style.display = 'none';
    document.getElementById('input-name').value = '';
    
    if (activePolyline) map.removeLayer(activePolyline);
    activeLinePoints = [];
    activePolyline = null;
    
    setMode('IDLE');
}

function deleteLine(id, e) {
    if(e) e.stopPropagation();
    if(confirm('Tem certeza que deseja remover esta linha?')) {
        const idx = dbLines.findIndex(x => x.id === id);
        if(idx > -1) {
            // Remove do mapa
            dbLines[idx].layers.forEach(l => map.removeLayer(l));
            // Remove do array
            dbLines.splice(idx, 1);
            saveToStorage();
            updateDashboard();
            showToast("Linha removida.");
        }
    }
}

function repairLine(id, e) {
    if(e) e.stopPropagation(); // Evita zoom ao clicar no botão
    const line = dbLines.find(l => l.id === id);
    
    if (line && confirm("Confirmar equipe de manutenção e reparo?")) {
        line.burst = null; // Remove vazamento
        saveToStorage();
        renderLineOnMap(line);
        
        if(systemActive) {
            // Restaura fluxo visual
            animateLineFlow(line, true);
        }
        
        updateDashboard();
        showToast("Reparo concluído. Pressão normalizada.");
    }
}

// Funções de UI
function showToast(msg) {
    const t = document.getElementById('toast-status');
    t.innerText = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
}

window.zoomToLine = function(id) {
    const l = dbLines.find(x => x.id === id);
    if(l && l.layers[0]) {
        map.fitBounds(l.layers[0].getBounds(), { padding: [50, 50] });
    }
}

window.clearAllData = function() {
    if(confirm('ATENÇÃO: Isso apagará TODOS os dados e reiniciará o sistema. Continuar?')) {
        localStorage.removeItem('usina_sys_v2');
        location.reload();
    }
}

// ==========================================
// 8. STORAGE (PERSISTÊNCIA)
// ==========================================

function saveToStorage() {
    // Salvamos apenas os dados puros (sem camadas Leaflet)
    const dataToSave = dbLines.map(l => ({
        id: l.id,
        name: l.name,
        type: l.type,
        nominalPressure: l.nominalPressure,
        points: l.points,
        burst: l.burst
    }));
    localStorage.setItem('usina_sys_v2', JSON.stringify(dataToSave));
}

function loadFromStorage() {
    const d = localStorage.getItem('usina_sys_v2');
    if(d) {
        const parsed = JSON.parse(d);
        parsed.forEach(l => {
            l.layers = []; // Reinicializa array de camadas
            dbLines.push(l);
            renderLineOnMap(l);
        });
        updateDashboard();
    }
}