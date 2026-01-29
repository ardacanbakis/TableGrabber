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
          const data = this.getTableData(message.indices, message.excludedRows, message.excludedCols);
          sendResponse({ data });
          break;

        case 'getTablePreview':
          const preview = this.getTablePreview(message.index);
          sendResponse({ preview });
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
    const allTables = [];
    const allElements = [];

    htmlTables.forEach((table, index) => {
      // Skip hidden tables and very small tables
      if (this.isElementVisible(table) && this.hasMinimumContent(table)) {
        const tableInfo = this.extractTableInfo(table, index);
        allTables.push(tableInfo);
        allElements.push(table);
      }
    });

    // Filter out bodyTable or layout tables if there are better alternatives
    const layoutTableNames = ['bodytable', 'body-table', 'layouttable', 'layout-table', 'maintable', 'main-table', 'pagetable', 'page-table'];

    if (allTables.length > 1) {
      // If we have multiple tables, filter out likely layout tables
      for (let i = 0; i < allTables.length; i++) {
        const name = (allTables[i].name || '').toLowerCase();
        const isLayoutTable = layoutTableNames.some(lt => name.includes(lt)) ||
                              allElements[i].id?.toLowerCase().includes('body') ||
                              allElements[i].id?.toLowerCase().includes('layout');

        if (!isLayoutTable) {
          this.tables.push(allTables[i]);
          this.tableElements.push(allElements[i]);
        }
      }

      // If filtering removed all tables, restore them
      if (this.tables.length === 0) {
        this.tables = allTables;
        this.tableElements = allElements;
      }
    } else {
      // Only one table, keep it
      this.tables = allTables;
      this.tableElements = allElements;
    }

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
    // Get only visible text content, excluding tooltips and hidden elements

    // Clone the cell to avoid modifying the original
    const clone = cell.cloneNode(true);

    // Remove elements that typically contain tooltip/hidden content
    const selectorsToRemove = [
      // Tooltip and popover elements
      '[class*="tooltip"]',
      '[class*="Tooltip"]',
      '[class*="popover"]',
      '[class*="Popover"]',
      '[class*="hint"]',
      '[class*="Hint"]',
      '[role="tooltip"]',
      // Screen reader only content
      '.sr-only',
      '.visually-hidden',
      '[aria-hidden="true"]',
      // Hidden elements
      '[style*="display: none"]',
      '[style*="display:none"]',
      '[style*="visibility: hidden"]',
      '[style*="visibility:hidden"]',
      '[hidden]',
      // Common framework tooltip/helper classes
      '.helper-text',
      '.help-text',
      '.field-help',
      '.field-description',
      '[class*="description"]',
      '[class*="helper"]',
      // Icons that might have text
      '[class*="icon"]',
      '[class*="Icon"]',
      'svg',
      'i.fa',
      'i.material-icons',
      // Dropdown menus
      '[class*="dropdown-menu"]',
      '[class*="menu-content"]',
      // Hover/overlay content
      '[class*="hover"]',
      '[class*="Hover"]',
      '[class*="overlay"]',
      '[class*="Overlay"]',
      '[class*="popup"]',
      '[class*="Popup"]',
      '[class*="flyout"]',
      '[class*="Flyout"]',
      // Info/details panels
      '[class*="info-panel"]',
      '[class*="detail"]',
      '[class*="Detail"]',
      '[class*="meta"]',
      '[class*="Meta"]',
      // Quickbase specific (based on your output)
      '[class*="FieldInfo"]',
      '[class*="field-info"]',
      '[class*="fieldUsage"]',
      '[class*="FieldUsage"]',
    ];

    selectorsToRemove.forEach(selector => {
      try {
        clone.querySelectorAll(selector).forEach(el => el.remove());
      } catch (e) {
        // Invalid selector, skip
      }
    });

    // Remove absolutely positioned elements (usually tooltips/overlays)
    clone.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);

      // Check for hidden elements
      if (style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.opacity === '0') {
        el.remove();
        return;
      }

      // Check for absolutely/fixed positioned elements (common for tooltips)
      if (style.position === 'absolute' || style.position === 'fixed') {
        el.remove();
        return;
      }

      // Check for elements positioned off-screen
      if (style.left === '-9999px' ||
          style.left === '-10000px' ||
          style.top === '-9999px' ||
          style.transform?.includes('translate')) {
        el.remove();
        return;
      }

      // Check for high z-index (often tooltips)
      const zIndex = parseInt(style.zIndex);
      if (zIndex > 100) {
        el.remove();
        return;
      }

      // Check for pointer-events: none (common for overlay content)
      if (style.pointerEvents === 'none') {
        el.remove();
        return;
      }
    });

    let text = '';

    // Check for input elements first
    const input = clone.querySelector('input, textarea, select');
    if (input) {
      text = input.value || input.placeholder || '';
    }

    // Check for images with alt text
    if (!text) {
      const img = clone.querySelector('img');
      if (img && img.alt) {
        text = img.alt;
      }
    }

    // Get text content from visible nodes only
    if (!text) {
      text = this.getVisibleText(clone);
    }

    // Clean up the text
    text = text.trim().replace(/\s+/g, ' ');

    // Post-process: remove common tooltip patterns from the text itself
    // Pattern: "Value Value (Type) Field ID: X ... Where is this field used?"
    text = this.cleanTooltipPatterns(text);

    return text;
  }

  cleanTooltipPatterns(text) {
    if (!text) return text;

    // Pattern 1: Remove "Where is this field used?" and everything after
    const whereIsIdx = text.indexOf('Where is this field used?');
    if (whereIsIdx > 0) {
      text = text.substring(0, whereIsIdx);
    }

    // Pattern 2: Remove "Field ID: X" and everything after
    const fieldIdMatch = text.match(/^(.+?)\s+Field ID:\s*\d+/);
    if (fieldIdMatch) {
      // Extract just the part before "Field ID:"
      const beforeFieldId = text.substring(0, text.indexOf('Field ID:'));
      text = beforeFieldId;
    }

    // Pattern 3: If text contains a duplicate (e.g., "Date Created Date Created (Date...")
    // extract just the first occurrence
    const words = text.trim().split(/\s+/);
    if (words.length >= 2) {
      // Look for duplicate patterns at the start
      for (let len = 1; len <= Math.floor(words.length / 2); len++) {
        const first = words.slice(0, len).join(' ');
        const second = words.slice(len, len * 2).join(' ');
        if (first === second) {
          // Found duplicate, take just the first part
          text = first;
          break;
        }
      }
    }

    // Pattern 4: Remove trailing metadata patterns
    // e.g., "(Date / Time)" at the end or parenthetical type info
    text = text.replace(/\s*\([^)]+\)\s*$/, '');

    // Clean up
    return text.trim().replace(/\s+/g, ' ');
  }

  getVisibleText(element) {
    // Recursively get text only from visible text nodes
    let text = '';

    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Check if parent is visible
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const style = window.getComputedStyle(parent);
          if (style.display === 'none' ||
              style.visibility === 'hidden' ||
              style.opacity === '0') {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip absolutely positioned parents
          if (style.position === 'absolute' || style.position === 'fixed') {
            return NodeFilter.FILTER_REJECT;
          }

          // Check if text is not just whitespace
          if (!node.textContent.trim()) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      text += node.textContent + ' ';
    }

    return text;
  }

  getTableData(indices, excludedRows = {}, excludedCols = {}) {
    const results = [];

    indices.forEach(index => {
      const element = this.tableElements[index];
      if (!element) return;

      const tableInfo = this.tables[index];
      let tableData;

      if (tableInfo.type === 'html') {
        tableData = this.extractHtmlTableData(element);
      } else {
        const divData = this.extractDivTableData(element);
        tableData = divData && divData.data ? divData.data : [];
      }

      // Apply row and column exclusions for this table
      const tableExcludedRows = excludedRows[index] || [];
      const tableExcludedCols = excludedCols[index] || [];

      if (tableExcludedRows.length > 0 || tableExcludedCols.length > 0) {
        tableData = this.applyExclusions(tableData, tableExcludedRows, tableExcludedCols);
      }

      results.push(tableData);
    });

    return results;
  }

  applyExclusions(data, excludedRows, excludedCols) {
    // Filter out excluded rows
    let filtered = data.filter((row, index) => !excludedRows.includes(index));

    // Filter out excluded columns
    if (excludedCols.length > 0) {
      filtered = filtered.map(row =>
        row.filter((cell, index) => !excludedCols.includes(index))
      );
    }

    return filtered;
  }

  getTablePreview(index) {
    const element = this.tableElements[index];
    if (!element) return null;

    const tableInfo = this.tables[index];
    let data;

    if (tableInfo.type === 'html') {
      data = this.extractHtmlTableData(element);
    } else {
      const divData = this.extractDivTableData(element);
      data = divData && divData.data ? divData.data : [];
    }

    return {
      data,
      rows: data.length,
      cols: data[0] ? data[0].length : 0,
      name: tableInfo.name
    };
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
