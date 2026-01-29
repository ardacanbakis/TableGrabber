// TableGrabber Content Script

class TableGrabber {
  constructor() {
    this.tables = [];
    this.tableElements = [];
    this.highlightsEnabled = true;
    this.init();
  }

  init() {
    this.setupMessageListener();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sendResponse);
      return true; // Keep channel open for async response
    });
  }

  async handleMessage(message, sendResponse) {
    try {
      switch (message.action) {
        case 'scanTables':
          const tables = this.scanTables();
          sendResponse({ tables });
          break;

        case 'scanDivTables':
          const divTables = this.scanDivTables();
          sendResponse({ tables: divTables });
          break;

        case 'getTableData':
          const data = this.getTableData(message.indices);
          sendResponse({ data });
          break;

        case 'highlightTable':
          this.highlightTable(message.index, message.highlight);
          sendResponse({ success: true });
          break;

        case 'toggleHighlights':
          this.toggleHighlights();
          sendResponse({ success: true });
          break;

        case 'prepareScreenshot':
          this.prepareScreenshot(message.index);
          sendResponse({ success: true });
          break;

        case 'getTableBounds':
          const bounds = this.getTableBounds(message.index);
          sendResponse({ bounds });
          break;

        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('TableGrabber error:', error);
      sendResponse({ error: error.message });
    }
  }

  scanTables() {
    this.tableElements = [];
    this.tables = [];

    // Find all HTML tables
    const htmlTables = document.querySelectorAll('table');

    htmlTables.forEach((table, index) => {
      // Skip hidden tables and very small tables
      if (this.isElementVisible(table) && this.hasMinimumContent(table)) {
        const tableInfo = this.extractTableInfo(table, index);
        this.tables.push(tableInfo);
        this.tableElements.push(table);
      }
    });

    return this.tables;
  }

  scanDivTables() {
    this.tableElements = [];
    this.tables = [];

    // Look for common div-based table patterns
    const patterns = [
      // Common CSS classes for div tables
      '[class*="table"]',
      '[class*="grid"]',
      '[class*="list"]',
      '[role="table"]',
      '[role="grid"]',
      // Data grids
      '[class*="datagrid"]',
      '[class*="data-grid"]',
      // Specific frameworks
      '.ag-root', // AG Grid
      '.k-grid', // Kendo
      '.dx-datagrid', // DevExtreme
      '.tabulator', // Tabulator
      '.handsontable', // Handsontable
    ];

    const candidates = new Set();

    patterns.forEach(pattern => {
      try {
        document.querySelectorAll(pattern).forEach(el => candidates.add(el));
      } catch (e) {
        // Invalid selector, skip
      }
    });

    // Also look for repetitive structures
    this.findRepetitiveStructures().forEach(el => candidates.add(el));

    // Process candidates
    let index = 0;
    candidates.forEach(element => {
      if (this.isElementVisible(element) && !this.isChildOfExisting(element)) {
        const tableData = this.extractDivTableData(element);
        if (tableData && tableData.rows >= 2 && tableData.cols >= 2) {
          this.tables.push({
            name: this.getElementName(element, index),
            rows: tableData.rows,
            cols: tableData.cols,
            preview: tableData.preview,
            type: 'div'
          });
          this.tableElements.push(element);
          index++;
        }
      }
    });

    return this.tables;
  }

  findRepetitiveStructures() {
    const candidates = [];

    // Look for containers with multiple similar children
    document.querySelectorAll('div, section, ul, ol').forEach(container => {
      const children = Array.from(container.children);
      if (children.length >= 3) {
        // Check if children have similar structure
        const tagCounts = {};
        children.forEach(child => {
          const signature = this.getElementSignature(child);
          tagCounts[signature] = (tagCounts[signature] || 0) + 1;
        });

        // If most children have the same signature, it might be a table
        const maxCount = Math.max(...Object.values(tagCounts));
        if (maxCount >= 3 && maxCount >= children.length * 0.7) {
          candidates.push(container);
        }
      }
    });

    return candidates;
  }

  getElementSignature(element) {
    const tag = element.tagName;
    const childTags = Array.from(element.children).map(c => c.tagName).sort().join(',');
    return `${tag}:${childTags}`;
  }

  isChildOfExisting(element) {
    return this.tableElements.some(existing =>
      existing.contains(element) || element.contains(existing)
    );
  }

  extractDivTableData(element) {
    // Try to extract tabular data from div-based structures
    const rows = [];

    // Strategy 1: Look for row-like children
    const rowCandidates = element.querySelectorAll('[class*="row"], [role="row"], tr, li');
    if (rowCandidates.length >= 2) {
      rowCandidates.forEach(row => {
        const cells = row.querySelectorAll('[class*="cell"], [class*="col"], [role="cell"], [role="gridcell"], td, th, span, div');
        if (cells.length >= 2) {
          const rowData = Array.from(cells).map(cell => this.getCellText(cell));
          rows.push(rowData);
        }
      });
    }

    // Strategy 2: Direct children as rows
    if (rows.length === 0) {
      const children = Array.from(element.children);
      children.forEach(child => {
        const subChildren = Array.from(child.children);
        if (subChildren.length >= 2) {
          const rowData = subChildren.map(cell => this.getCellText(cell));
          rows.push(rowData);
        } else if (child.textContent.trim()) {
          rows.push([this.getCellText(child)]);
        }
      });
    }

    if (rows.length < 2) return null;

    // Normalize column count
    const maxCols = Math.max(...rows.map(r => r.length));
    const normalizedRows = rows.map(row => {
      while (row.length < maxCols) row.push('');
      return row.slice(0, maxCols);
    });

    return {
      rows: normalizedRows.length,
      cols: maxCols,
      preview: normalizedRows[0] ? normalizedRows[0].slice(0, 3).join(', ').substring(0, 50) : '',
      data: normalizedRows
    };
  }

  isElementVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  hasMinimumContent(table) {
    const rows = table.querySelectorAll('tr');
    if (rows.length < 1) return false;

    // Check if table has at least 2 cells
    const cells = table.querySelectorAll('td, th');
    return cells.length >= 2;
  }

  extractTableInfo(table, index) {
    const rows = table.querySelectorAll('tr');
    const firstRow = rows[0];
    const cells = firstRow ? firstRow.querySelectorAll('td, th') : [];

    // Get table name from various sources
    const name = this.getTableName(table, index);

    // Get preview of first row
    const preview = Array.from(cells)
      .slice(0, 3)
      .map(cell => this.getCellText(cell))
      .join(', ')
      .substring(0, 50);

    // Count actual rows and columns
    let maxCols = 0;
    rows.forEach(row => {
      const rowCells = row.querySelectorAll('td, th');
      let colCount = 0;
      rowCells.forEach(cell => {
        colCount += cell.colSpan || 1;
      });
      maxCols = Math.max(maxCols, colCount);
    });

    return {
      name,
      rows: rows.length,
      cols: maxCols,
      preview,
      type: 'html'
    };
  }

  getTableName(table, index) {
    // Try various methods to get a meaningful name
    const caption = table.querySelector('caption');
    if (caption) return caption.textContent.trim();

    const ariaLabel = table.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const ariaLabelledBy = table.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }

    // Check for preceding heading
    let sibling = table.previousElementSibling;
    while (sibling) {
      if (/^H[1-6]$/.test(sibling.tagName)) {
        return sibling.textContent.trim();
      }
      sibling = sibling.previousElementSibling;
    }

    // Check ID or class
    if (table.id) return table.id;
    if (table.className) {
      const mainClass = table.className.split(' ')[0];
      if (mainClass && !mainClass.match(/^(table|data|grid)$/i)) {
        return mainClass;
      }
    }

    return `Table ${index + 1}`;
  }

  getElementName(element, index) {
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    if (element.id) return element.id;

    const className = element.className;
    if (className && typeof className === 'string') {
      const mainClass = className.split(' ')[0];
      if (mainClass) return mainClass;
    }

    return `DIV Table ${index + 1}`;
  }

  getCellText(cell) {
    // Get text content, handling various cases
    let text = '';

    // Check for input elements
    const input = cell.querySelector('input, textarea, select');
    if (input) {
      text = input.value || input.placeholder || '';
    }

    // Check for images with alt text
    const img = cell.querySelector('img');
    if (img && img.alt) {
      text = img.alt;
    }

    // Fall back to text content
    if (!text) {
      text = cell.textContent || '';
    }

    // Clean up the text
    return text.trim().replace(/\s+/g, ' ');
  }

  getTableData(indices) {
    const results = [];

    indices.forEach(index => {
      const element = this.tableElements[index];
      if (!element) return;

      const tableInfo = this.tables[index];

      if (tableInfo.type === 'html') {
        results.push(this.extractHtmlTableData(element));
      } else {
        const divData = this.extractDivTableData(element);
        if (divData && divData.data) {
          results.push(divData.data);
        }
      }
    });

    return results;
  }

  extractHtmlTableData(table) {
    const data = [];
    const rows = table.querySelectorAll('tr');

    rows.forEach(row => {
      const rowData = [];
      const cells = row.querySelectorAll('td, th');

      cells.forEach(cell => {
        const text = this.getCellText(cell);
        const colSpan = cell.colSpan || 1;

        // Add cell text
        rowData.push(text);

        // Handle colspan by adding empty cells
        for (let i = 1; i < colSpan; i++) {
          rowData.push('');
        }
      });

      if (rowData.length > 0) {
        data.push(rowData);
      }
    });

    // Normalize row lengths
    const maxCols = Math.max(...data.map(r => r.length));
    return data.map(row => {
      while (row.length < maxCols) row.push('');
      return row;
    });
  }

  highlightTable(index, highlight) {
    const element = this.tableElements[index];
    if (!element) return;

    if (highlight && this.highlightsEnabled) {
      element.classList.add('tablegrabber-highlight');
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      element.classList.remove('tablegrabber-highlight');
    }
  }

  toggleHighlights() {
    this.highlightsEnabled = !this.highlightsEnabled;

    if (!this.highlightsEnabled) {
      // Remove all highlights
      document.querySelectorAll('.tablegrabber-highlight').forEach(el => {
        el.classList.remove('tablegrabber-highlight');
      });
    }
  }

  prepareScreenshot(index) {
    const element = this.tableElements[index];
    if (!element) return;

    // Scroll to make table visible
    element.scrollIntoView({ behavior: 'instant', block: 'center' });

    // Add screenshot preparation class
    element.classList.add('tablegrabber-screenshot-target');
  }

  getTableBounds(index) {
    const element = this.tableElements[index];
    if (!element) return null;

    const rect = element.getBoundingClientRect();

    // Clean up
    element.classList.remove('tablegrabber-screenshot-target');

    return {
      x: Math.max(0, rect.x - 10),
      y: Math.max(0, rect.y - 10),
      width: rect.width + 20,
      height: rect.height + 20
    };
  }
}

// Initialize
const tableGrabber = new TableGrabber();
