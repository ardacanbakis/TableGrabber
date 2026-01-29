// TableGrabber Background Service Worker

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.action) {
      case 'downloadExcel':
        await downloadExcel(message.data, message.filename);
        sendResponse({ success: true });
        break;

      case 'captureScreenshot':
        await captureScreenshot(message.bounds);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Background script error:', error);
    sendResponse({ error: error.message });
  }
}

async function downloadExcel(data, filename) {
  // Create Excel file using a simple XML-based format (xlsx-like)
  // This is a simplified Excel export that works without external libraries

  const xmlContent = createExcelXML(data);
  const blob = new Blob([xmlContent], {
    type: 'application/vnd.ms-excel;charset=utf-8;'
  });

  const url = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url: url,
    filename: filename.replace('.xlsx', '.xls'),
    saveAs: true
  });

  // Clean up the object URL after a delay
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function createExcelXML(tables) {
  // Create a simple Excel XML spreadsheet
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#CCCCCC" ss:Pattern="Solid"/>
    </Style>
  </Styles>`;

  tables.forEach((table, tableIndex) => {
    xml += `
  <Worksheet ss:Name="Table ${tableIndex + 1}">
    <Table>`;

    table.forEach((row, rowIndex) => {
      xml += `
      <Row>`;

      row.forEach(cell => {
        const escapedCell = escapeXml(String(cell));
        const isNumber = !isNaN(cell) && cell !== '';
        const type = isNumber ? 'Number' : 'String';
        const style = rowIndex === 0 ? ' ss:StyleID="Header"' : '';

        xml += `
        <Cell${style}><Data ss:Type="${type}">${escapedCell}</Data></Cell>`;
      });

      xml += `
      </Row>`;
    });

    xml += `
    </Table>
  </Worksheet>`;
  });

  xml += `
</Workbook>`;

  return xml;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function captureScreenshot(bounds) {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Capture the visible tab
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png'
    });

    // If we have bounds, we need to crop the image
    // For now, we'll save the full screenshot
    // A more advanced implementation would use an offscreen canvas to crop

    const filename = `table_screenshot_${Date.now()}.png`;

    await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });

    return true;
  } catch (error) {
    console.error('Screenshot error:', error);
    throw error;
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('TableGrabber installed successfully!');
  } else if (details.reason === 'update') {
    console.log('TableGrabber updated to version', chrome.runtime.getManifest().version);
  }
});

// Optional: Add context menu for quick table capture
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'capture-table',
    title: 'Capture this table',
    contexts: ['all']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'capture-table') {
    // Send message to content script to capture clicked element
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'captureClickedTable'
      });
    } catch (error) {
      console.error('Error capturing table:', error);
    }
  }
});
