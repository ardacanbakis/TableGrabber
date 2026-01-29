// TableGrabber Popup Script

class TableGrabberPopup {
  constructor() {
    this.tables = [];
    this.selectedTables = new Set();
    this.init();
  }

  async init() {
    this.bindEvents();
    await this.scanForTables();
  }

  bindEvents() {
    // Select all checkbox
    document.getElementById('select-all').addEventListener('change', (e) => {
      this.toggleSelectAll(e.target.checked);
    });

    // Export buttons
    document.getElementById('copy-clipboard').addEventListener('click', () => {
      this.copyToClipboard();
    });

    document.getElementById('download-csv').addEventListener('click', () => {
      this.downloadCSV();
    });

    document.getElementById('download-excel').addEventListener('click', () => {
      this.downloadExcel();
    });

    document.getElementById('export-sheets').addEventListener('click', () => {
      this.exportToGoogleSheets();
    });

    document.getElementById('screenshot').addEventListener('click', () => {
      this.screenshotTable();
    });

    // Footer buttons
    document.getElementById('refresh-scan').addEventListener('click', () => {
      this.scanForTables();
    });

    document.getElementById('toggle-highlight').addEventListener('click', () => {
      this.toggleHighlights();
    });

    document.getElementById('scan-divs').addEventListener('click', () => {
      this.scanForDivTables();
    });
  }

  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async sendMessage(action, data = {}) {
    const tab = await this.getActiveTab();
    return chrome.tabs.sendMessage(tab.id, { action, ...data });
  }

  async scanForTables() {
    this.showLoading(true);
    this.hideAllSections();

    try {
      const response = await this.sendMessage('scanTables');
      this.tables = response.tables || [];
      this.renderTables();
    } catch (error) {
      console.error('Error scanning tables:', error);
      this.showStatus('Error scanning page. Please refresh and try again.', 'error');
    }

    this.showLoading(false);
  }

  async scanForDivTables() {
    this.showLoading(true);
    this.hideAllSections();

    try {
      const response = await this.sendMessage('scanDivTables');
      this.tables = response.tables || [];
      this.renderTables();
    } catch (error) {
      console.error('Error scanning div tables:', error);
      this.showStatus('Error scanning for div tables.', 'error');
    }

    this.showLoading(false);
  }

  renderTables() {
    const tablesList = document.getElementById('tables-list');
    const tablesFound = document.getElementById('tables-found');
    const noTables = document.getElementById('no-tables');
    const tableCount = document.getElementById('table-count');

    if (this.tables.length === 0) {
      noTables.classList.remove('hidden');
      tablesFound.classList.add('hidden');
      return;
    }

    noTables.classList.add('hidden');
    tablesFound.classList.remove('hidden');
    tableCount.textContent = `${this.tables.length} table${this.tables.length !== 1 ? 's' : ''} found`;

    tablesList.innerHTML = this.tables.map((table, index) => `
      <div class="table-item" data-index="${index}">
        <input type="checkbox" class="table-checkbox" data-index="${index}">
        <div class="table-info">
          <div class="table-name">${this.escapeHtml(table.name || `Table ${index + 1}`)}</div>
          <div class="table-meta">${table.rows} rows × ${table.cols} columns</div>
        </div>
        <div class="table-preview">${this.escapeHtml(table.preview || '')}</div>
      </div>
    `).join('');

    // Bind click events for table items
    tablesList.querySelectorAll('.table-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.type !== 'checkbox') {
          const checkbox = item.querySelector('.table-checkbox');
          checkbox.checked = !checkbox.checked;
          this.updateSelection(parseInt(item.dataset.index), checkbox.checked);
        }
      });

      item.querySelector('.table-checkbox').addEventListener('change', (e) => {
        this.updateSelection(parseInt(item.dataset.index), e.target.checked);
      });

      // Highlight table on hover
      item.addEventListener('mouseenter', () => {
        this.highlightTable(parseInt(item.dataset.index), true);
      });

      item.addEventListener('mouseleave', () => {
        this.highlightTable(parseInt(item.dataset.index), false);
      });
    });

    // Select first table by default
    if (this.tables.length > 0) {
      const firstCheckbox = tablesList.querySelector('.table-checkbox');
      if (firstCheckbox) {
        firstCheckbox.checked = true;
        this.updateSelection(0, true);
      }
    }
  }

  updateSelection(index, selected) {
    if (selected) {
      this.selectedTables.add(index);
    } else {
      this.selectedTables.delete(index);
    }

    // Update select all checkbox
    const selectAll = document.getElementById('select-all');
    selectAll.checked = this.selectedTables.size === this.tables.length;
    selectAll.indeterminate = this.selectedTables.size > 0 && this.selectedTables.size < this.tables.length;

    // Update visual state
    const item = document.querySelector(`.table-item[data-index="${index}"]`);
    if (item) {
      item.classList.toggle('selected', selected);
    }
  }

  toggleSelectAll(selected) {
    this.selectedTables.clear();
    document.querySelectorAll('.table-checkbox').forEach((checkbox, index) => {
      checkbox.checked = selected;
      if (selected) {
        this.selectedTables.add(index);
      }
      const item = checkbox.closest('.table-item');
      if (item) {
        item.classList.toggle('selected', selected);
      }
    });
  }

  async highlightTable(index, highlight) {
    try {
      await this.sendMessage('highlightTable', { index, highlight });
    } catch (error) {
      console.error('Error highlighting table:', error);
    }
  }

  async toggleHighlights() {
    try {
      await this.sendMessage('toggleHighlights');
    } catch (error) {
      console.error('Error toggling highlights:', error);
    }
  }

  getSelectedTableIndices() {
    return Array.from(this.selectedTables).sort((a, b) => a - b);
  }

  async copyToClipboard() {
    const indices = this.getSelectedTableIndices();
    if (indices.length === 0) {
      this.showStatus('Please select at least one table.', 'error');
      return;
    }

    const format = document.getElementById('export-format').value;

    try {
      const response = await this.sendMessage('getTableData', { indices });
      const data = response.data;

      let text = '';
      switch (format) {
        case 'tsv':
          text = this.formatAsTSV(data);
          break;
        case 'csv':
          text = this.formatAsCSV(data);
          break;
        case 'markdown':
          text = this.formatAsMarkdown(data);
          break;
        case 'json':
          text = JSON.stringify(data, null, 2);
          break;
      }

      await navigator.clipboard.writeText(text);
      this.showStatus(`Copied ${indices.length} table(s) to clipboard!`, 'success');
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      this.showStatus('Error copying to clipboard.', 'error');
    }
  }

  formatAsTSV(tables) {
    return tables.map(table =>
      table.map(row => row.join('\t')).join('\n')
    ).join('\n\n');
  }

  formatAsCSV(tables) {
    return tables.map(table =>
      table.map(row =>
        row.map(cell => {
          const escaped = String(cell).replace(/"/g, '""');
          return /[,"\n\r]/.test(cell) ? `"${escaped}"` : escaped;
        }).join(',')
      ).join('\n')
    ).join('\n\n');
  }

  formatAsMarkdown(tables) {
    return tables.map(table => {
      if (table.length === 0) return '';

      const header = table[0];
      const separator = header.map(() => '---');
      const rows = table.slice(1);

      const lines = [
        '| ' + header.join(' | ') + ' |',
        '| ' + separator.join(' | ') + ' |',
        ...rows.map(row => '| ' + row.join(' | ') + ' |')
      ];

      return lines.join('\n');
    }).join('\n\n');
  }

  async downloadCSV() {
    const indices = this.getSelectedTableIndices();
    if (indices.length === 0) {
      this.showStatus('Please select at least one table.', 'error');
      return;
    }

    try {
      const response = await this.sendMessage('getTableData', { indices });
      const csv = this.formatAsCSV(response.data);

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const tab = await this.getActiveTab();
      const hostname = new URL(tab.url).hostname;
      const filename = `table_${hostname}_${Date.now()}.csv`;

      await chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: true
      });

      this.showStatus('CSV download started!', 'success');
    } catch (error) {
      console.error('Error downloading CSV:', error);
      this.showStatus('Error downloading CSV.', 'error');
    }
  }

  async downloadExcel() {
    const indices = this.getSelectedTableIndices();
    if (indices.length === 0) {
      this.showStatus('Please select at least one table.', 'error');
      return;
    }

    try {
      const response = await this.sendMessage('getTableData', { indices });

      // Send message to background script to handle Excel generation
      chrome.runtime.sendMessage({
        action: 'downloadExcel',
        data: response.data,
        filename: `table_${Date.now()}.xlsx`
      }, (result) => {
        if (result && result.success) {
          this.showStatus('Excel download started!', 'success');
        } else {
          this.showStatus('Error creating Excel file.', 'error');
        }
      });
    } catch (error) {
      console.error('Error downloading Excel:', error);
      this.showStatus('Error downloading Excel.', 'error');
    }
  }

  async exportToGoogleSheets() {
    const indices = this.getSelectedTableIndices();
    if (indices.length === 0) {
      this.showStatus('Please select at least one table.', 'error');
      return;
    }

    try {
      const response = await this.sendMessage('getTableData', { indices });
      const tsv = this.formatAsTSV(response.data);

      // Copy to clipboard and open Google Sheets
      await navigator.clipboard.writeText(tsv);

      // Open Google Sheets
      chrome.tabs.create({
        url: 'https://docs.google.com/spreadsheets/create'
      });

      this.showStatus('Data copied! Paste (Ctrl+V) in Google Sheets.', 'success');
    } catch (error) {
      console.error('Error exporting to Google Sheets:', error);
      this.showStatus('Error exporting to Google Sheets.', 'error');
    }
  }

  async screenshotTable() {
    const indices = this.getSelectedTableIndices();
    if (indices.length === 0) {
      this.showStatus('Please select at least one table.', 'error');
      return;
    }

    // Only screenshot the first selected table
    const index = indices[0];

    try {
      await this.sendMessage('prepareScreenshot', { index });

      // Give time for the table to be prepared
      setTimeout(async () => {
        try {
          const response = await this.sendMessage('getTableBounds', { index });

          chrome.runtime.sendMessage({
            action: 'captureScreenshot',
            bounds: response.bounds
          }, (result) => {
            if (result && result.success) {
              this.showStatus('Screenshot saved!', 'success');
            } else {
              this.showStatus('Error taking screenshot.', 'error');
            }
          });
        } catch (err) {
          console.error('Error getting table bounds:', err);
          this.showStatus('Error taking screenshot.', 'error');
        }
      }, 100);
    } catch (error) {
      console.error('Error preparing screenshot:', error);
      this.showStatus('Error taking screenshot.', 'error');
    }
  }

  showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
  }

  hideAllSections() {
    document.getElementById('no-tables').classList.add('hidden');
    document.getElementById('tables-found').classList.add('hidden');
    this.hideStatus();
  }

  showStatus(message, type = 'info') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.classList.remove('hidden');

    // Auto-hide after 3 seconds
    setTimeout(() => {
      this.hideStatus();
    }, 3000);
  }

  hideStatus() {
    document.getElementById('status').classList.add('hidden');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new TableGrabberPopup();
});
