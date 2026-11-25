// Global variables
let leaderboardData = [];
let currentDomain = 'overall'; // will be mapped to 'Overall' when displaying
let isOracleMode = false; // toggle to switch between benchmark_results.csv and benchmark_oracle.csv
let isObscuredMode = false; // toggle to switch between benchmark_results.csv and benchmark_obscured.csv
let pipelineDesignData = [];
let pipelineImplementationData = [];

function updateLeaderboardTitle() {
  const title = document.querySelector('.leaderboard-section h2');

  if (!title) {
    return;
  }

  if (isOracleMode) {
    title.textContent = 'Current Rankings (Oracle Inputs)';
  } else if (isObscuredMode) {
    title.textContent = 'Current Rankings (Obscured Inputs)';
  } else {
    title.textContent = 'Current Rankings';
  }
}

function pulseToggleContainer(toggleContainer) {
  if (!toggleContainer) {
    return;
  }

  toggleContainer.classList.add('pulse');
  setTimeout(() => {
    toggleContainer.classList.remove('pulse');
  }, 500);
}

function setBenchmarkMode(mode) {
  const oracleToggle = document.querySelector('#oracle-toggle');
  const obscuredToggle = document.querySelector('#obscured-toggle');

  isOracleMode = mode === 'oracle';
  isObscuredMode = mode === 'obscured';

  if (oracleToggle) {
    oracleToggle.checked = isOracleMode;
  }

  if (obscuredToggle) {
    obscuredToggle.checked = isObscuredMode;
  }

  updateLeaderboardTitle();
}

function handleBenchmarkToggleChange(event) {
  const toggleId = event.target.id;
  const toggleContainer = event.target.closest('.toggle-container');

  if (toggleId === 'oracle-toggle') {
    setBenchmarkMode(event.target.checked ? 'oracle' : 'results');
  } else if (toggleId === 'obscured-toggle') {
    setBenchmarkMode(event.target.checked ? 'obscured' : 'results');
  }

  loadLeaderboard();
  pulseToggleContainer(toggleContainer);
}

function handleBenchmarkToggleClick(event) {
  const toggleInput = event.currentTarget.querySelector('input[type="checkbox"]');

  if (!toggleInput || event.target === toggleInput) {
    return;
  }

  event.preventDefault();
  toggleInput.checked = !toggleInput.checked;
  toggleInput.dispatchEvent(new Event('change', { bubbles: true }));
}

function handleBenchmarkToggleKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  const toggleInput = event.currentTarget.querySelector('input[type="checkbox"]');

  if (!toggleInput) {
    return;
  }

  event.preventDefault();
  toggleInput.checked = !toggleInput.checked;
  toggleInput.dispatchEvent(new Event('change', { bubbles: true }));
}

// Load and display leaderboard data
async function loadLeaderboard() {
  try {
    const csvFile = isOracleMode
      ? 'data/benchmark_oracle.csv'
      : isObscuredMode
        ? 'data/benchmark_obscured.csv'
        : 'data/benchmark_results.csv';
    console.log(`Loading data from: ${csvFile} (Oracle mode: ${isOracleMode}, Obscured mode: ${isObscuredMode})`);
    
    const response = await fetch(csvFile);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, { header: true });
    
    if (parsed.errors && parsed.errors.length > 0) {
      console.warn('CSV parsing errors:', parsed.errors);
    }
    
    // Filter out empty rows, require System and Models fields
    console.log('Parsed CSV data:', parsed.data);
    leaderboardData = parsed.data.filter(d => d.System && d.System.trim() !== '' && d.Models && d.Models.trim() !== '');
    console.log('Filtered leaderboard data:', leaderboardData);

    displayLeaderboard(currentDomain);
    
  } catch (error) {
    console.error('Error loading leaderboard:', error);
    const tbody = document.querySelector("#leaderboard-table tbody");
    if (tbody) {
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #dc3545;">Error loading leaderboard data: ' + error.message + '</td></tr>';
    }
  }
}

// Global variable for search term
let currentSearchTerm = '';

// Display leaderboard for selected domain
function displayLeaderboard(domain, searchTerm = currentSearchTerm) {
  if (!leaderboardData.length) {
  const tbody = document.querySelector("#leaderboard-table tbody");
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #dc3545;">No data available</td></tr>';
    return;
  }
  
  // Store the current search term for reusing when domain changes
  currentSearchTerm = searchTerm;
  
  // Adjust domain name casing (benchmark_results.csv uses capitalized domain names)
  const adjustedDomain = domain.charAt(0).toUpperCase() + domain.slice(1);
  
  // Filter out entries that don't have a score for this domain
  let validData = leaderboardData.filter(entry => {
    const score = parseFloat(entry[adjustedDomain]);
    return !isNaN(score) && score >= 0;
  });
  
  // Apply search filter if provided
  if (searchTerm && searchTerm.trim() !== '') {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();
    validData = validData.filter(entry => {
      const system = (entry.System || '').toLowerCase();
      const model = (entry.Models || '').toLowerCase();
      return system.includes(normalizedSearchTerm) || model.includes(normalizedSearchTerm);
    });
    
    // Add a status message about filtered results
    const filterStatus = document.querySelector('#filter-status');
    if (filterStatus) {
      filterStatus.textContent = `Showing ${validData.length} filtered results with original rankings`;
      filterStatus.style.display = 'block';
    }
  } else {
    // Clear the filter status message when no search
    const filterStatus = document.querySelector('#filter-status');
    if (filterStatus) {
      filterStatus.style.display = 'none';
    }
  }
  
  if (!validData.length) {
  const tbody = document.querySelector("#leaderboard-table tbody");
  tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #dc3545;">No matching results found</td></tr>';
    return;
  }
  
  // First, sort ALL valid data by domain score to determine original rankings
  const allValidData = leaderboardData.filter(entry => {
    const score = parseFloat(entry[adjustedDomain]);
    return !isNaN(score) && score >= 0;
  }).sort((a, b) => {
    const scoreA = parseFloat(a[adjustedDomain]) || 0;
    const scoreB = parseFloat(b[adjustedDomain]) || 0;
    return scoreB - scoreA;
  });
  
  // Create a map of entries to their original rankings
  const originalRankMap = new Map();
  allValidData.forEach((entry, index) => {
    // Use a unique identifier combining system, model and score to ensure proper mapping
    // This handles cases where systems/models might have identical names
    const score = parseFloat(entry[adjustedDomain]) || 0;
    const uniqueId = `${entry.System}-${entry.Models}-${score.toFixed(3)}`;
    originalRankMap.set(uniqueId, index + 1);
  });
  
  // Now sort the filtered valid data by original rank (to preserve order)
  const sortedData = [...validData].sort((a, b) => {
    const scoreA = parseFloat(a[adjustedDomain]) || 0;
    const scoreB = parseFloat(b[adjustedDomain]) || 0;
    
    // If we're searching, sort by original rank to maintain the global ranking order
    if (searchTerm && searchTerm.trim() !== '') {
      const idA = `${a.System}-${a.Models}-${scoreA.toFixed(3)}`;
      const idB = `${b.System}-${b.Models}-${scoreB.toFixed(3)}`;
      const rankA = originalRankMap.get(idA) || 999;
      const rankB = originalRankMap.get(idB) || 999;
      return rankA - rankB;
    }
    
    // Otherwise, sort by score
    return scoreB - scoreA;
  });

  const tbody = document.querySelector("#leaderboard-table tbody");
  tbody.innerHTML = ''; // Clear existing content
  
  sortedData.forEach((entry) => {
    const row = document.createElement("tr");
    
    // Get score once and use it for both ranking and display
    const score = parseFloat(entry[adjustedDomain]) || 0;
    const scoreDisplay = escapeHtml((entry[adjustedDomain] || `${score.toFixed(1)}%`).trim());
    const overallBenchmarkTime = escapeHtml((entry['Overall Benchmark Time'] || '-').trim());
    
    // Get the original rank using the same unique identifier format
    const uniqueId = `${entry.System}-${entry.Models}-${score.toFixed(3)}`;
    const originalRank = originalRankMap.get(uniqueId);
    
    // Add special styling for top 3 based on original rank
    if (originalRank <= 3) {
      row.classList.add(`rank-${originalRank}`);
    }
    
    // Highlight search terms if present
    let systemText = escapeHtml(entry.System);
    let modelText = escapeHtml(entry.Models);
    
    if (searchTerm && searchTerm.trim() !== '') {
      const regex = new RegExp(`(${escapeHtml(searchTerm.trim())})`, 'gi');
      systemText = systemText.replace(regex, '<mark>$1</mark>');
      modelText = modelText.replace(regex, '<mark>$1</mark>');
    }
    
    row.innerHTML = `
      <td>${originalRank}</td>
      <td>${systemText}</td>
      <td>${modelText}</td>
      <td>${scoreDisplay}</td>
      <td>${overallBenchmarkTime}</td>
    `;
    tbody.appendChild(row);
  });
  
  // Add top performers styling
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
      <td>${escapeHtml((entry.System || '-').trim())}</td>
      <td>${escapeHtml((entry.Models || '-').trim())}</td>
      <td>${escapeHtml((entry.Overall || '-').trim())}</td>
    `;
    tableBody.appendChild(row);
  });
}

async function loadPipelineScores() {
  const sources = [
    {
      url: 'data/pipeline_design_scores.csv',
      assignData: data => {
        pipelineDesignData = data;
      }
    },
    {
      url: 'data/pipeline_implementation_scores.csv',
      assignData: data => {
        pipelineImplementationData = data;
      }
    }
  ];

  await Promise.all(sources.map(async source => {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`HTTP error (${source.url}): ${response.status}`);
    }

    const csvText = await response.text();
    const parsed = Papa.parse(csvText, { header: true });
    if (parsed.errors && parsed.errors.length > 0) {
      console.warn(`CSV parsing errors for ${source.url}:`, parsed.errors);
    }

    const cleanRows = parsed.data.filter(row => {
      const hasBasicFields = row.System && row.System.trim() !== '' && row.Models && row.Models.trim() !== '';
      const hasValidScore = !Number.isNaN(parseScoreValue(row.Overall));
      return hasBasicFields && hasValidScore;
    });
    source.assignData(cleanRows);
  }));

  renderPipelineTable('#pipeline-design-table', pipelineDesignData);
  renderPipelineTable('#pipeline-implementation-table', pipelineImplementationData);
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

// Handle oracle and obscured toggle setup
function handleOracleToggle() {
  const oracleToggle = document.querySelector('#oracle-toggle');
  const oracleContainer = document.querySelector('#oracle-toggle-container');
  const obscuredToggle = document.querySelector('#obscured-toggle');
  const obscuredContainer = document.querySelector('#obscured-toggle-container');
  
  if (oracleToggle) {
    isOracleMode = oracleToggle.checked;
    if (isOracleMode) {
      isObscuredMode = false;
      if (obscuredToggle) {
        obscuredToggle.checked = false;
      }
    }

    oracleToggle.addEventListener('change', handleBenchmarkToggleChange);
    if (oracleContainer) {
      oracleContainer.addEventListener('click', handleBenchmarkToggleClick);
      oracleContainer.addEventListener('keydown', handleBenchmarkToggleKeydown);
    }
  }

  if (obscuredToggle) {
    isObscuredMode = obscuredToggle.checked;
    if (isObscuredMode) {
      isOracleMode = false;
      if (oracleToggle) {
        oracleToggle.checked = false;
      }
    }

    obscuredToggle.addEventListener('change', handleBenchmarkToggleChange);
    if (obscuredContainer) {
      obscuredContainer.addEventListener('click', handleBenchmarkToggleClick);
      obscuredContainer.addEventListener('keydown', handleBenchmarkToggleKeydown);
    }
  }

  updateLeaderboardTitle();
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
  loadLeaderboard();
  loadPipelineScores().catch(error => {
    console.error('Error loading pipeline scores:', error);
    renderPipelineTable('#pipeline-design-table', []);
    renderPipelineTable('#pipeline-implementation-table', []);
  });
  handleDomainChange();
  handleOracleToggle();
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
  handleOracleToggle,
  handleSearch
};
