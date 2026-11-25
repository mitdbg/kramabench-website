// Leaderboard state
let leaderboardData = [];
let currentDomain = 'overall'; // will be mapped to 'Overall' when displaying
let currentDataset = 'public';
let pipelineDesignData = [];
let pipelineImplementationData = [];
let currentSearchTerm = '';
let isLoadingLeaderboard = false;
let leaderboardRequestId = 0;
let pipelineRequestId = 0;


const SYSTEM_LINKS = {
  "DS-Guru": "https://arxiv.org/abs/2506.06541",
  "DS-Guru no-context": "https://arxiv.org/abs/2506.06541",
  "DS-Guru one-shot": "https://arxiv.org/abs/2506.06541",
  "DS-Guru few-shot": "https://arxiv.org/abs/2506.06541",
  "DS-Guru one-shot (full-input subtasks)": "https://arxiv.org/abs/2506.06541",
  "DS-Guru few-shot (full-input subtasks)": "https://arxiv.org/abs/2506.06541",
  "smolagents DR": "https://github.com/huggingface/smolagents/tree/main/examples/open_deep_research",
  "smolagents Reflexion": "https://arxiv.org/abs/2506.06541",
  "smolagents PDT": "https://arxiv.org/abs/2506.06541",
  "RADAR": "https://arxiv.org/abs/2609.32528",
  "DeepAnalyze": "https://ruc-deepanalyze.github.io/",
  "DeepAnalyze (obscured, 103 tasks)": "https://ruc-deepanalyze.github.io/",
  "TalkTask": "https://talktask.si/",
  "TalkTask (public)": "https://talktask.si/",
  "TalkTask (obscured, 103 tasks)": "https://talktask.si/"
};

function validateSystemUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

function getSystemUrl(system) {
  const name = String(system || '').trim();
  const candidate = SYSTEM_LINKS[name] || (name.startsWith('DS-Guru ') ? SYSTEM_LINKS['DS-Guru'] : null);
  return validateSystemUrl(candidate);
}

function highlightText(text, searchTerm = '') {
  const value = String(text || '');
  const term = String(searchTerm || '').trim();
  if (!term) return escapeHtml(value);
  const escaped = term.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  return value.split(new RegExp('(' + escaped + ')', 'gi')).map(part =>
    part.toLowerCase() === term.toLowerCase()
      ? '<mark>' + escapeHtml(part) + '</mark>'
      : escapeHtml(part)
  ).join('');
}

function renderSystemLabel(system, searchTerm = '', candidateUrl = getSystemUrl(system)) {
  const label = highlightText(system || '-', searchTerm);
  const url = validateSystemUrl(candidateUrl);
  if (!url) return label;
  const safeUrl = escapeHtml(url).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return '<a class="system-link" href="' + safeUrl +
    '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
}

function showLeaderboardMessage(message) {
  const body = document.querySelector('#leaderboard-table tbody');
  if (body) body.innerHTML = '<tr><td colspan="5" class="table-message">' + escapeHtml(message) + '</td></tr>';
}

function syncLeaderboardControls() {
  const title = document.querySelector('#leaderboard-title');
  const label = currentDataset === 'oracle' ? 'Oracle inputs' :
    currentDataset === 'obscured' ? 'Obscured dataset' : 'Public dataset';
  if (title) title.textContent = 'Current Rankings (' + label + ')';
  const description = document.querySelector('#dataset-description');
  if (description) description.textContent = currentDataset === 'obscured'
    ? 'Obscured dataset: 103 main tasks. Rankings are separate from the public dataset.'
    : currentDataset === 'oracle'
      ? 'Public dataset: 104 main tasks, with Oracle inputs.'
      : 'Public dataset: 104 main tasks, with full inputs.';
  const status = document.querySelector('#filter-status');
  if (status) {
    status.textContent = '';
    status.style.display = 'none';
  }
}

async function loadLeaderboard() {
  const requestId = ++leaderboardRequestId;
  const csvFile = currentDataset === 'obscured'
    ? 'data/benchmark_obscured.csv'
    : currentDataset === 'oracle' ? 'data/benchmark_oracle.csv' : 'data/benchmark_results.csv';
  leaderboardData = [];
  isLoadingLeaderboard = true;
  syncLeaderboardControls();
  showLeaderboardMessage('Loading results…');
  try {
    const response = await fetch(csvFile);
    if (requestId !== leaderboardRequestId) return;
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const csvText = await response.text();
    if (requestId !== leaderboardRequestId) return;
    const parsed = Papa.parse(csvText, { header: true });
    leaderboardData = parsed.data.filter(row => row.System && row.System.trim() && row.Models && row.Models.trim());
    isLoadingLeaderboard = false;
    displayLeaderboard(currentDomain);
  } catch (error) {
    if (requestId !== leaderboardRequestId) return;
    leaderboardData = [];
    isLoadingLeaderboard = false;
    console.error('Error loading leaderboard:', error);
    showLeaderboardMessage('Unable to load results. Please try again.');
  }
}

function displayLeaderboard(domain, searchTerm = currentSearchTerm) {
  currentSearchTerm = String(searchTerm || '');
  if (!leaderboardData.length) {
    showLeaderboardMessage(isLoadingLeaderboard ? 'Loading results…' : 'No results available for this dataset and input setting.');
    return;
  }
  const adjustedDomain = domain.charAt(0).toUpperCase() + domain.slice(1);
  const ranked = leaderboardData.filter(entry => {
    const score = parseFloat(entry[adjustedDomain]);
    return !Number.isNaN(score) && score >= 0;
  }).sort((a, b) => parseFloat(b[adjustedDomain]) - parseFloat(a[adjustedDomain]));
  const ranks = new Map(ranked.map((entry, index) => [entry, index + 1]));
  const term = currentSearchTerm.trim().toLowerCase();
  const visible = ranked.filter(entry => !term ||
    entry.System.toLowerCase().includes(term) || entry.Models.toLowerCase().includes(term));
  const status = document.querySelector('#filter-status');
  if (status) {
    status.textContent = term ? 'Showing ' + visible.length + ' filtered results with original rankings' : '';
    status.style.display = term ? 'block' : 'none';
  }
  if (!visible.length) {
    showLeaderboardMessage('No matching results found.');
    return;
  }
  const body = document.querySelector('#leaderboard-table tbody');
  body.innerHTML = '';
  for (const entry of visible) {
    const row = document.createElement('tr');
    const rank = ranks.get(entry);
    if (rank <= 3) row.classList.add('rank-' + rank);
    row.innerHTML = '<td>' + rank + '</td><td>' +
      renderSystemLabel(entry.System, currentSearchTerm) + '</td><td>' +
      highlightText(entry.Models, currentSearchTerm) + '</td><td>' +
      escapeHtml(entry[adjustedDomain].trim()) + '</td><td>' +
      escapeHtml((entry['Overall Benchmark Time'] || '-').trim()) + '</td>';
    body.appendChild(row);
  }
  addTopPerformersStyling();
}

function parseScoreValue(rawScore) {
  const scoreText = typeof rawScore === 'string' ? rawScore : '';
  const match = scoreText.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return NaN;
  }
  return parseFloat(match[0]);
}

function renderPipelineTable(tableSelector, entries) {
  const tableBody = document.querySelector(`${tableSelector} tbody`);
  if (!tableBody) {
    return;
  }

  if (!entries.length) {
    tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #dc3545;">No data available</td></tr>';
    return;
  }

  const sortedEntries = [...entries].sort((a, b) => {
    const scoreA = parseScoreValue(a.Overall);
    const scoreB = parseScoreValue(b.Overall);
    const safeScoreA = Number.isNaN(scoreA) ? -Infinity : scoreA;
    const safeScoreB = Number.isNaN(scoreB) ? -Infinity : scoreB;
    return safeScoreB - safeScoreA;
  });

  tableBody.innerHTML = '';
  sortedEntries.forEach((entry, index) => {
    const rank = index + 1;
    const row = document.createElement('tr');
    if (rank <= 3) {
      row.classList.add(`rank-${rank}`);
    }

    row.innerHTML = `
      <td>${rank}</td>
      <td>${renderSystemLabel((entry.System || '-').trim())}</td>
      <td>${escapeHtml((entry.Models || '-').trim())}</td>
      <td>${escapeHtml((entry.Overall || '-').trim())}</td>
    `;
    tableBody.appendChild(row);
  });
}

function renderPipelineScores() {
  const unavailableForSelection = currentDataset !== 'public';
  const tables = document.querySelector('#pipeline-tables');
  const unavailable = document.querySelector('#pipeline-empty-state');
  const title = document.querySelector('#pipeline-title');
  const label = currentDataset === 'oracle' ? 'Oracle inputs' :
    currentDataset === 'obscured' ? 'Obscured dataset' : 'Public dataset';
  if (title) title.textContent = 'Pipeline Scores (' + label + ')';
  if (tables) tables.hidden = unavailableForSelection;
  if (unavailable) {
    unavailable.hidden = !unavailableForSelection;
    unavailable.textContent = currentDataset === 'oracle'
      ? 'No pipeline scores are available for Oracle inputs.'
      : 'No pipeline scores are available for the obscured dataset.';
  }
  if (unavailableForSelection) {
    for (const selector of ['#pipeline-design-table tbody', '#pipeline-implementation-table tbody']) {
      const body = document.querySelector(selector);
      if (body) body.innerHTML = '';
    }
    return;
  }
  renderPipelineTable('#pipeline-design-table', pipelineDesignData);
  renderPipelineTable('#pipeline-implementation-table', pipelineImplementationData);
}

async function loadPipelineScores() {
  const requestId = ++pipelineRequestId;
  try {
    const results = await Promise.all([
      'data/pipeline_design_scores.csv', 'data/pipeline_implementation_scores.csv'
    ].map(async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const parsed = Papa.parse(await response.text(), { header: true });
      return parsed.data.filter(row => row.System && row.System.trim() && row.Models && row.Models.trim() &&
        !Number.isNaN(parseScoreValue(row.Overall)));
    }));
    if (requestId !== pipelineRequestId) return;
    [pipelineDesignData, pipelineImplementationData] = results;
    renderPipelineScores();
  } catch (error) {
    if (requestId !== pipelineRequestId) return;
    console.error('Error loading pipeline scores:', error);
    pipelineDesignData = [];
    pipelineImplementationData = [];
    renderPipelineScores();
  }
}

// Handle domain selection change
function handleDomainChange() {
  const domainSelector = document.querySelector('#domain-selector');
  
  if (domainSelector) {
    // Update domain selector options to match capitalized domains in benchmark_results.csv
    const domains = ['Overall', 'Archaeology', 'Astronomy', 'Biomedical', 'Environment', 'Legal', 'Wildfire'];
    
    // Clear existing options
    domainSelector.innerHTML = '';
    
    // Add new options
    domains.forEach(domain => {
      const option = document.createElement('option');
      option.value = domain.toLowerCase();
      option.textContent = domain;
      domainSelector.appendChild(option);
    });
    
    domainSelector.addEventListener('change', function(e) {
      currentDomain = e.target.value;
      displayLeaderboard(currentDomain);
    });
  }
}

function handleDatasetChange(event) {
  if (!event.target.checked || !['public', 'oracle', 'obscured'].includes(event.target.value)) return;
  currentDataset = event.target.value;
  syncLeaderboardControls();
  renderPipelineScores();
  loadLeaderboard();
}

function handleDatasetToggle() {
  for (const radio of document.querySelectorAll('input[name="dataset"]')) {
    radio.addEventListener('change', handleDatasetChange);
    if (radio.checked) currentDataset = radio.value;
  }
  syncLeaderboardControls();
}

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Format date for display
function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  } catch (error) {
    return dateString; // Return original if parsing fails
  }
}

// Add special styling for top performers
function addTopPerformersStyling() {
  const styles = `
    <style>
      .rank-1 td:first-child::before { content: "🥇 "; }
      .rank-2 td:first-child::before { content: "🥈 "; }
      .rank-3 td:first-child::before { content: "🥉 "; }
      .rank-1:hover, .rank-2:hover, .rank-3:hover { 
        transform: scale(1.01); 
        transition: transform 0.2s ease;
      }
    </style>
  `;
  
  if (!document.querySelector('#top-performers-styles')) {
    const styleElement = document.createElement('div');
    styleElement.id = 'top-performers-styles';
    styleElement.innerHTML = styles;
    document.head.appendChild(styleElement);
  }
}

// Smooth scrolling for navigation links
function initSmoothScrolling() {
  document.querySelectorAll('.sidebar a[href^="#"]').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const targetId = this.getAttribute('href');
      const targetElement = document.querySelector(targetId);
      
      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
}

// Handle search functionality
function handleSearch() {
  const searchInput = document.querySelector('#search-input');
  const clearSearchBtn = document.querySelector('#clear-search');
  
  if (searchInput && clearSearchBtn) {
    // Search as you type (with debounce)
    let debounceTimeout;
    
    searchInput.addEventListener('input', function() {
      currentSearchTerm = this.value;
      clearTimeout(debounceTimeout);
      
      // Show/hide clear button
      if (this.value) {
        clearSearchBtn.style.display = 'block';
      } else {
        clearSearchBtn.style.display = 'none';
      }
      
      // Debounce the search
      debounceTimeout = setTimeout(() => {
        displayLeaderboard(currentDomain, this.value);
      }, 300);
    });
    
    // Clear search when button is clicked
    clearSearchBtn.addEventListener('click', function() {
      searchInput.value = '';
      clearSearchBtn.style.display = 'none';
      displayLeaderboard(currentDomain, '');
      
      // Add focus back to input
      searchInput.focus();
    });
    
    // Handle enter key press
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        displayLeaderboard(currentDomain, this.value);
      } else if (e.key === 'Escape') {
        // Clear on escape
        this.value = '';
        clearSearchBtn.style.display = 'none';
        displayLeaderboard(currentDomain, '');
      }
    });
  }
}

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
  handleDomainChange();
  handleDatasetToggle();
  loadLeaderboard();
  loadPipelineScores();
  handleSearch();
  initSmoothScrolling();
  
  // Auto-refresh leaderboard every 5 minutes
  setInterval(loadLeaderboard, 5 * 60 * 1000);
});

// Export functions for potential external use
window.KramaBench = {
  loadLeaderboard,
  loadPipelineScores,
  displayLeaderboard,
  formatDate,
  escapeHtml,
  handleDomainChange,
  handleDatasetToggle,
  handleDatasetChange,
  renderPipelineScores,
  validateSystemUrl,
  getSystemUrl,
  renderSystemLabel,
  highlightText,
  handleSearch
};
