(() => {
  const config = CONFIG;
  const getQuote = () => quote;
  const money = value => `฿${(Math.round(Number(value) * 100) / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
  const vatRate = Number(config.vatRate);
  const tools = document.createElement('section');
  tools.id = 'documentTools';
  tools.className = 'document-tools';
  tools.hidden = true;
  tools.innerHTML = `
    <h3>เอกสารสำหรับลูกค้า</h3>
    <p class="hint">กรอกราคาที่ตกลงจริง (ยังไม่รวม VAT) และข้อมูลผู้ซื้อก่อนออกเอกสาร</p>
    <div class="document-fields">
      <label>ชื่อผู้ซื้อ / ผู้รับบริการ
        <input id="docBuyerName" type="text" autocomplete="name" required>
      </label>
      <label>ที่อยู่ผู้ซื้อ
        <textarea id="docBuyerAddress" rows="2" required></textarea>
      </label>
      <label>เลขประจำตัวผู้เสียภาษีผู้ซื้อ (ถ้ามี)
        <input id="docBuyerTaxId" type="text" inputmode="numeric">
      </label>
      <label>สาขาผู้ซื้อ (ถ้ามี)
        <input id="docBuyerBranch" type="text" value="สำนักงานใหญ่ (00000)">
      </label>
      <label>ราคาที่ตกลง (ก่อน VAT)
        <input id="docAmount" type="number" min="0" step="0.01" required>
      </label>
      <label>กำหนดชำระ (ใบแจ้งหนี้)
        <input id="docDueDate" type="date" required>
      </label>
      <label>ช่องทางชำระเงิน (ใบรับเงิน)
        <input id="docPaymentMethod" type="text" placeholder="เช่น โอนเงิน">
      </label>
      <label>จำนวนเงินที่ได้รับ (ใบรับเงิน)
        <input id="docPaidAmount" type="number" min="0.01" step="0.01" required>
      </label>
    </div>
    <label class="document-confirm">
      <input id="docPaidConfirmed" type="checkbox">
      ข้าพเจ้าตรวจสอบแล้วว่าได้รับชำระเงินจริง ก่อนออกใบรับเงิน
    </label>
    <div class="buttons document-actions">
      <button class="btn small" type="button" data-document="invoice">สร้างใบแจ้งหนี้</button>
      <button class="btn alt small" type="button" data-document="receipt">ออกใบรับเงิน</button>
      <button class="btn alt small" type="button" data-document="back" hidden>กลับใบประเมินราคา</button>
    </div>
    <p class="document-status" role="status" aria-live="polite"></p>
    <p class="hint document-disclaimer">เอกสารนี้เป็นเครื่องมือช่วยจัดทำข้อมูล ไม่ได้ส่งหรือบันทึกบนเซิร์ฟเวอร์ เลขที่เอกสารเก็บเฉพาะในเบราว์เซอร์เครื่องนี้ และไม่ใช่ใบกำกับภาษี กรุณาตรวจสอบข้อกำหนดกับผู้ทำบัญชีก่อนใช้งานจริง</p>`;

  const quoteResult = document.querySelector('#quoteResult');
  const quotePaper = document.querySelector('#quotePaper');
  const quoteForm = document.querySelector('#quoteForm');
  const downloadButton = document.querySelector('#downloadWord');
  const emailButton = document.querySelector('#emailQuote');
  let originalQuoteHtml = '';
  let currentDocument = null;
  let temporarySequence = 0;

  quoteResult.insertBefore(tools, quoteResult.querySelector('.notice'));
  const pricingNote = document.querySelector('#services .wrap > .hint');
  if (config.vatRegistered && pricingNote) {
    pricingNote.append(document.createTextNode(' ราคาเริ่มต้นยังไม่รวม VAT 7%'));
  }

  const field = id => tools.querySelector(`#${id}`);
  const status = (message, isError = false) => {
    const element = tools.querySelector('.document-status');
    element.textContent = message;
    element.classList.toggle('is-error', isError);
  };
  const calculateTotals = amount => {
    const subtotal = Number(amount);
    if (!Number.isFinite(subtotal) || subtotal < 0) return null;
    const vat = Math.round(subtotal * vatRate * 100) / 100;
    return { subtotal, vat, total: subtotal + vat };
  };
  const nextNumber = type => {
    const year = new Date().getFullYear();
    const key = `pellist-document-sequence-${year}`;
    try {
      const sequence = JSON.parse(localStorage.getItem(key) || '{}');
      const next = Number(sequence[type] || 0) + 1;
      sequence[type] = next;
      localStorage.setItem(key, JSON.stringify(sequence));
      return { number: `${type}-${year}-${String(next).padStart(4, '0')}`, persistent: true };
    } catch (error) {
      temporarySequence += 1;
      const suffix = `${Date.now().toString(36).toUpperCase()}-${temporarySequence}`;
      return { number: `${type}-${year}-T${suffix}`, persistent: false, storageError: error.message };
    }
  };
  const dateText = value => new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));

  const setQuoteDefaults = () => {
    const currentQuote = getQuote();
    if (!currentQuote) return;
    if (config.vatRegistered) {
      const currentTotals = calculateTotals(currentQuote.s.price);
      const quoteTotal = quotePaper.querySelector('.quote-total');
      if (currentTotals && quoteTotal) {
        quoteTotal.textContent = `รวมก่อน VAT: ${money(currentTotals.subtotal)}`;
        const vatLine = document.createElement('p');
        vatLine.className = 'quote-total';
        vatLine.style.textAlign = 'right';
        vatLine.textContent = `VAT 7%: ${money(currentTotals.vat)}`;
        const grossLine = document.createElement('p');
        grossLine.className = 'quote-total';
        grossLine.style.cssText = 'text-align:right;font-size:18px';
        grossLine.textContent = `รวมสุทธิ: ${money(currentTotals.total)}`;
        quoteTotal.after(vatLine, grossLine);
      }
    }
    originalQuoteHtml = quotePaper.innerHTML;
    currentDocument = null;
    field('docBuyerName').value = currentQuote.name;
    field('docBuyerAddress').value = '';
    field('docBuyerTaxId').value = '';
    field('docBuyerBranch').value = 'สำนักงานใหญ่ (00000)';
    field('docAmount').value = Number(currentQuote.s.price).toFixed(2);
    field('docPaidAmount').value = (Number(currentQuote.s.price) * (1 + vatRate)).toFixed(2);
    field('docPaymentMethod').value = '';
    field('docPaidConfirmed').checked = false;
    const due = new Date();
    due.setDate(due.getDate() + 7);
    field('docDueDate').value = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    tools.hidden = false;
    tools.querySelector('[data-document="back"]').hidden = true;
    status('');
  };

  const createDocument = type => {
    const currentQuote = getQuote();
    if (!currentQuote) {
      status('ไม่พบข้อมูลใบประเมิน กรุณาสร้างใบประเมินราคาใหม่', true);
      return;
    }
    if (!field('docBuyerName').value.trim() || !field('docBuyerAddress').value.trim()) {
      status('กรุณากรอกชื่อและที่อยู่ผู้ซื้อให้ครบก่อนออกเอกสาร', true);
      return;
    }
    if (type === 'receipt' && !field('docPaidConfirmed').checked) {
      status('กรุณายืนยันว่าได้รับชำระเงินจริงก่อนออกใบรับเงิน', true);
      field('docPaidConfirmed').focus();
      return;
    }
    if (type === 'invoice' && !field('docDueDate').value) {
      status('กรุณาระบุกำหนดชำระของใบแจ้งหนี้', true);
      field('docDueDate').focus();
      return;
    }
    const totals = calculateTotals(field('docAmount').value);
    if (!totals) {
      status('กรุณาระบุราคาก่อน VAT เป็นจำนวนที่ถูกต้อง', true);
      field('docAmount').focus();
      return;
    }
    const paidAmount = Number(field('docPaidAmount').value);
    if (type === 'receipt' && (!Number.isFinite(paidAmount) || paidAmount <= 0 || paidAmount > totals.total)) {
      status(`จำนวนเงินที่ได้รับต้องมากกว่า 0 และไม่เกินยอดสุทธิ ${money(totals.total)}`, true);
      field('docPaidAmount').focus();
      return;
    }
    let numberInfo;
    try {
      numberInfo = nextNumber(type === 'invoice' ? 'INV' : 'REC');
    } catch (error) {
      status(`บันทึกเลขเอกสารในเบราว์เซอร์ไม่สำเร็จ: ${error.message}`, true);
      return;
    }
    const { number, persistent, storageError } = numberInfo;
    const isInvoice = type === 'invoice';
    const documentDate = new Date();
    const date = documentDate.toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' });
    const dueDate = field('docDueDate').value;
    const buyerName = field('docBuyerName').value.trim();
    const buyerAddress = field('docBuyerAddress').value.trim();
    const buyerTaxId = field('docBuyerTaxId').value.trim();
    const buyerBranch = field('docBuyerBranch').value.trim();
    const paymentMethod = field('docPaymentMethod').value.trim();
    const heading = isInvoice ? 'ใบแจ้งหนี้' : 'ใบรับเงิน / ใบเสร็จรับเงิน';
    const taxTitle = isInvoice ? 'ยอด VAT 7%' : 'VAT 7%';
    currentDocument = { type, number, buyerName, totals, persistent };

    quotePaper.innerHTML = `
      <div class="business-document">
        <header class="business-document-header">
          <div>
            <div class="quote-brand"><strong>${escapeHtml(config.quoteLogoText)}</strong><span>${escapeHtml(config.quoteLogoTagline)}</span></div>
            <p>${escapeHtml(config.accountName)} · ${escapeHtml(config.brand)}<br>
              ${config.address ? `${escapeHtml(config.address)}<br>` : ''}
              ${config.taxId ? `เลขประจำตัวผู้เสียภาษี ${escapeHtml(config.taxId)}${config.branchCode ? ` · สาขา ${escapeHtml(config.branchCode)}` : ''}<br>` : ''}
              ${escapeHtml(config.email)} · ${escapeHtml(config.phone)}</p>
          </div>
          <div class="business-document-reference">
            <h2>${heading}</h2>
            <b>${escapeHtml(number)}</b><br>อ้างอิงใบประเมิน ${escapeHtml(currentQuote.ref)}<br>วันที่ ${escapeHtml(date)}
            ${isInvoice ? `<br>กำหนดชำระ ${escapeHtml(dateText(dueDate))}` : '<br>ได้รับชำระเงินแล้ว'}
          </div>
        </header>
        <hr>
        <section class="business-document-buyer">
          <b>ผู้ซื้อ / ผู้รับบริการ</b><br>
          ${escapeHtml(buyerName)}<br>
          ${escapeHtml(buyerAddress).replace(/\n/g, '<br>')}
          ${buyerTaxId ? `<br>เลขประจำตัวผู้เสียภาษี ${escapeHtml(buyerTaxId)}${buyerBranch ? ` · สาขา ${escapeHtml(buyerBranch)}` : ''}` : ''}
        </section>
        <table class="business-document-table">
          <thead><tr><th>รายการ</th><th>จำนวน</th><th>ราคาก่อน VAT</th><th>รวม</th></tr></thead>
          <tbody><tr>
            <td>${escapeHtml(currentQuote.s.name)}<br><small>${escapeHtml(currentQuote.s.description)}</small></td>
            <td>1</td><td>${money(totals.subtotal)}</td><td>${money(totals.subtotal)}</td>
          </tr></tbody>
        </table>
        <div class="business-document-totals">
          <div><span>รวมก่อน VAT</span><b>${money(totals.subtotal)}</b></div>
          <div><span>${taxTitle}</span><b>${money(totals.vat)}</b></div>
          <div class="business-document-grand-total"><span>ยอดรวมสุทธิ</span><b>${money(totals.total)}</b></div>
        </div>
        ${isInvoice
          ? `<p><b>ช่องทางชำระเงิน:</b> ${config.bankAccount ? `โอนเข้าบัญชี ${escapeHtml(config.bankName)} ${escapeHtml(config.bankAccount)}<br><b>ชื่อบัญชี:</b> ${escapeHtml(config.accountName)}` : 'โปรดติดต่อ PELLIST. เพื่อรับรายละเอียดการชำระเงิน'}</p>`
          : `<p><b>รับชำระโดย:</b> ${escapeHtml(paymentMethod || 'ไม่ระบุ')}<br><b>จำนวนเงินที่ได้รับ:</b> ${money(paidAmount)}<br><b>ยอดคงเหลือ:</b> ${money(totals.total - paidAmount)}</p>`}
        <p class="business-document-note">${isInvoice
          ? 'โปรดชำระภายในวันที่กำหนด เอกสารนี้จัดทำจากข้อมูลที่กรอกในเบราว์เซอร์'
          : 'ผู้จัดทำยืนยันว่าได้รับชำระเงินตามจำนวนข้างต้นแล้ว เอกสารนี้จัดทำจากข้อมูลที่กรอกในเบราว์เซอร์'}
          <br>เอกสารนี้ไม่ใช่ใบกำกับภาษี กรุณาตรวจสอบและออกเอกสารภาษีตามข้อกำหนดที่เกี่ยวข้องกับผู้ทำบัญชี</p>
        ${persistent ? '' : '<p class="business-document-note"><b>คำเตือน:</b> เบราว์เซอร์ไม่สามารถบันทึกลำดับเลขเอกสารได้ เลขนี้เป็นเลขชั่วคราว กรุณาบันทึกและตรวจสอบเลขเอกสารด้วยตนเอง</p>'}
      </div>`;
    tools.querySelector('[data-document="back"]').hidden = false;
    status(persistent
      ? `${heading} ${number} สร้างแล้ว — บันทึกหรือพิมพ์เอกสารก่อนออกจากหน้านี้`
      : `${heading} ${number} สร้างแล้ว แต่เบราว์เซอร์บันทึกลำดับไม่ได้ (${storageError}) — กรุณาจดเลขเอกสารไว้เอง`);
    quotePaper.scrollIntoView({ block: 'nearest' });
  };

  document.addEventListener('submit', event => {
    if (event.target === quoteForm) {
      setQuoteDefaults();
    }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-document]');
    if (!button) return;
    if (button.dataset.document === 'back') {
      quotePaper.innerHTML = originalQuoteHtml;
      currentDocument = null;
      tools.querySelector('[data-document="back"]').hidden = true;
      status('');
      return;
    }
    createDocument(button.dataset.document);
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-project]')) {
      tools.hidden = true;
    }
  });

  const originalDownloadHandler = downloadButton.onclick;
  downloadButton.onclick = event => {
    if (!currentDocument) {
      originalDownloadHandler.call(downloadButton, event);
      return;
    }
    const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;padding:30px;line-height:1.7}.business-document{max-width:900px;margin:auto}.business-document-header{display:flex;justify-content:space-between;gap:24px}.business-document-totals{text-align:right}.business-document-totals>div{display:flex;justify-content:flex-end;gap:30px}.business-document-table{width:100%;border-collapse:collapse}.business-document-table th,.business-document-table td{padding:9px;border-bottom:1px solid #ddd;text-align:left}.business-document-note{margin-top:32px;font-size:12px}</style></head><body>${quotePaper.innerHTML}</body></html>`;
    const blob = new Blob(['\ufeff', documentHtml], { type: 'application/msword;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${currentDocument.number}.doc`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  };

  const originalEmailHandler = emailButton.onclick;
  emailButton.onclick = event => {
    if (!currentDocument) {
      originalEmailHandler.call(emailButton, event);
      return;
    }
    const subject = `${currentDocument.type === 'invoice' ? 'ใบแจ้งหนี้' : 'ใบรับเงิน'} ${currentDocument.number}`;
    const body = [
      `เลขที่เอกสาร: ${currentDocument.number}`,
      `ผู้ซื้อ: ${currentDocument.buyerName}`,
      `ยอดก่อน VAT: ${money(currentDocument.totals.subtotal)}`,
      `VAT 7%: ${money(currentDocument.totals.vat)}`,
      `ยอดรวม: ${money(currentDocument.totals.total)}`,
      '',
      'กรุณาแนบไฟล์เอกสารที่ดาวน์โหลดไว้ก่อนส่งอีเมล',
    ].join('\n');
    window.location.href = `mailto:${encodeURIComponent(config.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
})();
