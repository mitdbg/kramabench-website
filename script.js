// Global variables
let leaderboardData = [];
let currentDomain = 'overall';

// Load and display leaderboard data
async function loadLeaderboard() {
  try {
    const response = await fetch("data/leaderboard.csv");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, { header: true });
    
    if (parsed.errors && parsed.errors.length > 0) {
      console.warn('CSV parsing errors:', parsed.errors);
    }
    
    // Filter out empty rows, only require team name
    // leaderboardData = parsed.data.filter(d => d.team && d.team.trim() !== '');
    console.log('Parsed CSV data:', parsed.data);
    leaderboardData = parsed.data.filter(d => d.team && d.team.trim() !== '');
    console.log('Filtered leaderboard data:', leaderboardData);

    displayLeaderboard(currentDomain);
    
  } catch (error) {
    console.error('Error loading leaderboard:', error);
    const tbody = document.querySelector("#leaderboard-table tbody");
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #dc3545;">Error loading leaderboard data: ' + error.message + '</td></tr>';
    }
  }
}

// Display leaderboard for selected domain
function displayLeaderboard(domain) {
  if (!leaderboardData.length) {
    const tbody = document.querySelector("#leaderboard-table tbody");
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #dc3545;">No data available</td></tr>';
    return;
  }
  
  // Filter out entries that don't have a score for this domain
  const validData = leaderboardData.filter(entry => {
    const score = parseFloat(entry[domain]);
    return !isNaN(score) && score >= 0;
  });
  
  if (!validData.length) {
    const tbody = document.querySelector("#leaderboard-table tbody");
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #dc3545;">No data available for this domain</td></tr>';
    return;
  }
  
  // Sort by domain score descending
  const sortedData = [...validData].sort((a, b) => {
    const scoreA = parseFloat(a[domain]) || 0;
    const scoreB = parseFloat(b[domain]) || 0;
    return scoreB - scoreA;
  });

  const tbody = document.querySelector("#leaderboard-table tbody");
  tbody.innerHTML = ''; // Clear existing content
  
  sortedData.forEach((entry, i) => {
    const row = document.createElement("tr");
    
    // Add special styling for top 3
    if (i < 3) {
      row.classList.add(`rank-${i + 1}`);
    }
    
    const score = parseFloat(entry[domain]) || 0;
    const runtime = parseFloat(entry.runtime) || 0;
    
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${escapeHtml(entry.team)}</td>
      <td>${score.toFixed(1)}%</td>
      <td>${runtime.toFixed(1)}s</td>
      <td>${formatDate(entry.date)}</td>
      <td><a href="${escapeHtml(entry.paper_url)}" target="_blank" title="View paper">📄</a></td>
    `;
    tbody.appendChild(row);
  });
  
  // Add top performers styling
  addTopPerformersStyling();
}

// Handle domain selection change
function handleDomainChange() {
  const domainSelector = document.querySelector('#domain-selector');
  
  if (domainSelector) {
    domainSelector.addEventListener('change', function(e) {
      currentDomain = e.target.value;
      displayLeaderboard(currentDomain);
    });
  }
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
      .rank-1 { background: linear-gradient(90deg, #ffd700, #ffed4e) !important; }
      .rank-1 td:first-child::before { content: "🥇 "; }
      .rank-2 { background: linear-gradient(90deg, #c0c0c0, #e5e5e5) !important; }
      .rank-2 td:first-child::before { content: "🥈 "; }
      .rank-3 { background: linear-gradient(90deg, #cd7f32, #daa520) !important; }
      .rank-3 td:first-child::before { content: "🥉 "; }
      .rank-1:hover, .rank-2:hover, .rank-3:hover { 
        transform: scale(1.02); 
        transition: transform 0.2s ease;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
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

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
  loadLeaderboard();
  handleDomainChange();
  initSmoothScrolling();
  
  // Auto-refresh leaderboard every 5 minutes
  setInterval(loadLeaderboard, 5 * 60 * 1000);
});

// Export functions for potential external use
window.KramaBench = {
  loadLeaderboard,
  displayLeaderboard,
  formatDate,
  escapeHtml,
  handleDomainChange
};
