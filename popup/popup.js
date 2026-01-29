// TableGrabber Popup Script

class TableGrabberPopup {
  constructor() {
    this.tables = [];
    this.selectedTables = new Set();
    this.currentPreviewIndex = null;
    this.previewData = null;
    this.excludedRows = {}; // { tableIndex: [rowIndices] }
    this.excludedCols = {}; // { tableIndex: [colIndices] }
    this.rowSelectMode = false;
    this.colSelectMode = false;
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

    const scanDivsFooter = document.getElementById('scan-divs-footer');
    if (scanDivsFooter) {
      scanDivsFooter.addEventListener('click', () => {
        this.scanForDivTables();
      });
    }

    // Preview controls
    document.getElementById('toggle-row-select').addEventListener('click', () => {
      this.toggleRowSelectMode();
    });

    document.getElementById('toggle-col-select').addEventListener('click', () => {
      this.toggleColSelectMode();
    });

    document.getElementById('clear-exclusions').addEventListener('click', () => {
      this.clearExclusions();
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
    this.hidePreview();

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
    this.hidePreview();

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

    // Don't auto-select first table - let user choose to avoid lag on large tables
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

    // Show preview for single selected table
    if (this.selectedTables.size === 1) {
      const selectedIndex = Array.from(this.selectedTables)[0];
      this.showPreview(selectedIndex);
    } else if (this.selectedTables.size === 0) {
      this.hidePreview();
    } else {
      // Multiple tables selected - show combined info
      this.showMultiplePreview();
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

    if (selected && this.tables.length === 1) {
      this.showPreview(0);
    } else if (selected && this.tables.length > 1) {
      this.showMultiplePreview();
    } else {
      this.hidePreview();
    }
  }

  async showPreview(index) {
    this.currentPreviewIndex = index;

    try {
      const response = await this.sendMessage('getTablePreview', { index });
      this.previewData = response.preview;

      if (!this.previewData || !this.previewData.data) {
        this.hidePreview();
        return;
      }

      // Initialize exclusions for this table if needed
      if (!this.excludedRows[index]) {
        this.excludedRows[index] = [];
      }
      if (!this.excludedCols[index]) {
        this.excludedCols[index] = [];
      }

      this.renderPreview();

      document.getElementById('preview-section').classList.remove('hidden');
      document.body.classList.add('preview-active');
    } catch (error) {
      console.error('Error loading preview:', error);
      this.hidePreview();
    }
  }

  showMultiplePreview() {
    const previewSection = document.getElementById('preview-section');
    const previewTitle = document.getElementById('preview-title');
    const previewStats = document.getElementById('preview-stats');
    const previewContainer = document.getElementById('preview-container');

    previewTitle.textContent = 'Multiple Tables Selected';

    const totalRows = Array.from(this.selectedTables).reduce((sum, idx) => {
      return sum + (this.tables[idx]?.rows || 0);
    }, 0);

    previewStats.textContent = `${this.selectedTables.size} tables, ${totalRows} total rows`;
    previewContainer.innerHTML = '<p style="padding: 20px; text-align: center; color: #666;">Select a single table to preview and edit exclusions</p>';

    previewSection.classList.remove('hidden');
    document.body.classList.add('preview-active');

    // Hide exclusion controls for multiple tables
    document.getElementById('toggle-row-select').classList.add('hidden');
    document.getElementById('toggle-col-select').classList.add('hidden');
    document.getElementById('clear-exclusions').classList.add('hidden');
  }

  renderPreview() {
    const data = this.previewData.data;
    const previewTitle = document.getElementById('preview-title');
    const previewStats = document.getElementById('preview-stats');
    const previewTable = document.getElementById('preview-table');
    const exclusionInfo = document.getElementById('exclusion-info');

    previewTitle.textContent = this.previewData.name || 'Table Preview';

    const excludedRowCount = this.excludedRows[this.currentPreviewIndex]?.length || 0;
    const excludedColCount = this.excludedCols[this.currentPreviewIndex]?.length || 0;
    const effectiveRows = data.length - excludedRowCount;
    const effectiveCols = (data[0]?.length || 0) - excludedColCount;

    previewStats.textContent = `${effectiveRows} rows × ${effectiveCols} columns`;

    if (excludedRowCount > 0 || excludedColCount > 0) {
      exclusionInfo.textContent = `Excluding: ${excludedRowCount} rows, ${excludedColCount} cols`;
      exclusionInfo.classList.remove('hidden');
    } else {
      exclusionInfo.classList.add('hidden');
    }

    // Show exclusion controls
    document.getElementById('toggle-row-select').classList.remove('hidden');
    document.getElementById('toggle-col-select').classList.remove('hidden');
    document.getElementById('clear-exclusions').classList.remove('hidden');

    // Build table HTML
    let html = '<thead><tr>';

    // Header row with column numbers
    html += '<th class="row-num">#</th>';
    if (data[0]) {
      data[0].forEach((cell, colIdx) => {
        const isExcluded = this.excludedCols[this.currentPreviewIndex]?.includes(colIdx);
        const colClass = this.colSelectMode ? 'col-selectable' : '';
        const excludedClass = isExcluded ? 'excluded' : '';
        html += `<th class="${colClass} ${excludedClass}" data-col="${colIdx}">${this.escapeHtml(this.truncate(cell, 50))}</th>`;
      });
    }
    html += '</tr></thead><tbody>';

    // Data rows
    data.forEach((row, rowIdx) => {
      const isRowExcluded = this.excludedRows[this.currentPreviewIndex]?.includes(rowIdx);
      const rowClass = this.rowSelectMode ? 'selectable' : '';
      const excludedClass = isRowExcluded ? 'excluded' : '';

      html += `<tr class="${rowClass} ${excludedClass}" data-row="${rowIdx}">`;

      // Row number
      const rowNumClass = this.rowSelectMode ? 'selectable' : '';
      html += `<td class="row-num ${rowNumClass}" data-row="${rowIdx}">${rowIdx + 1}</td>`;

      row.forEach((cell, colIdx) => {
        const isColExcluded = this.excludedCols[this.currentPreviewIndex]?.includes(colIdx);
        const colClass = this.colSelectMode ? 'col-selectable' : '';
        const cellExcludedClass = isColExcluded ? 'excluded' : '';
        html += `<td class="${colClass} ${cellExcludedClass}" data-col="${colIdx}">${this.escapeHtml(this.truncate(cell, 80))}</td>`;
      });

      html += '</tr>';
    });

    html += '</tbody>';
    previewTable.innerHTML = html;

    // Bind click events for row/column selection
    this.bindPreviewEvents();
  }

  bindPreviewEvents() {
    const previewTable = document.getElementById('preview-table');

    // Row selection
    previewTable.querySelectorAll('tr[data-row]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (this.rowSelectMode) {
          const rowIdx = parseInt(row.dataset.row);
          this.toggleRowExclusion(rowIdx);
        }
      });
    });

    // Column selection (click on header)
    previewTable.querySelectorAll('th[data-col], td[data-col]').forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (this.colSelectMode) {
          e.stopPropagation();
          const colIdx = parseInt(cell.dataset.col);
          this.toggleColExclusion(colIdx);
        }
      });
    });
  }

  toggleRowSelectMode() {
    this.rowSelectMode = !this.rowSelectMode;
    this.colSelectMode = false;

    document.getElementById('toggle-row-select').classList.toggle('active', this.rowSelectMode);
    document.getElementById('toggle-col-select').classList.remove('active');

    if (this.previewData) {
      this.renderPreview();
    }
  }

  toggleColSelectMode() {
    this.colSelectMode = !this.colSelectMode;
    this.rowSelectMode = false;

    document.getElementById('toggle-col-select').classList.toggle('active', this.colSelectMode);
    document.getElementById('toggle-row-select').classList.remove('active');

    if (this.previewData) {
      this.renderPreview();
    }
  }

  toggleRowExclusion(rowIdx) {
    const index = this.currentPreviewIndex;
    if (!this.excludedRows[index]) {
      this.excludedRows[index] = [];
    }

    const pos = this.excludedRows[index].indexOf(rowIdx);
    if (pos === -1) {
      this.excludedRows[index].push(rowIdx);
    } else {
      this.excludedRows[index].splice(pos, 1);
    }

    this.renderPreview();
  }

  toggleColExclusion(colIdx) {
    const index = this.currentPreviewIndex;
    if (!this.excludedCols[index]) {
      this.excludedCols[index] = [];
    }

    const pos = this.excludedCols[index].indexOf(colIdx);
    if (pos === -1) {
      this.excludedCols[index].push(colIdx);
    } else {
      this.excludedCols[index].splice(pos, 1);
    }

    this.renderPreview();
  }

  clearExclusions() {
    if (this.currentPreviewIndex !== null) {
      this.excludedRows[this.currentPreviewIndex] = [];
      this.excludedCols[this.currentPreviewIndex] = [];
      this.renderPreview();
    }
  }

  hidePreview() {
    document.getElementById('preview-section').classList.add('hidden');
    document.body.classList.remove('preview-active');
    this.currentPreviewIndex = null;
    this.previewData = null;
    this.rowSelectMode = false;
    this.colSelectMode = false;
    document.getElementById('toggle-row-select').classList.remove('active');
    document.getElementById('toggle-col-select').classList.remove('active');
  }

  truncate(str, maxLen) {
    str = String(str || '');
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
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
      const response = await this.sendMessage('getTableData', {
        indices,
        excludedRows: this.excludedRows,
        excludedCols: this.excludedCols
      });
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
      const response = await this.sendMessage('getTableData', {
        indices,
        excludedRows: this.excludedRows,
        excludedCols: this.excludedCols
      });
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
      const response = await this.sendMessage('getTableData', {
        indices,
        excludedRows: this.excludedRows,
        excludedCols: this.excludedCols
      });

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
      const response = await this.sendMessage('getTableData', {
        indices,
        excludedRows: this.excludedRows,
        excludedCols: this.excludedCols
      });
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
