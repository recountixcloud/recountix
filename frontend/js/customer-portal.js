(function(){
  'use strict';

  const dict = {
    en: {
      portal: 'Customer Portal',
      title: 'Check your payment status',
      subtitle: 'Enter your business code, registered mobile number and portal PIN to view your bill, paid amount and pending amount.',
      businessCode: 'Business Code',
      mobile: 'Registered Mobile Number',
      pin: 'Portal PIN',
      check: 'Check Status',
      privacy: 'For privacy, this page needs a portal PIN set by the business.',
      staffLogin: 'Staff login',
      empty: 'Your secure summary will appear here.',
      bill: 'Bill Amount',
      paid: 'Paid Amount',
      pending: 'Pending Amount',
      lastPayment: 'Last Payment',
      recent: 'Recent Payments',
      notFound: 'No matching record found. Check business code, mobile number and PIN.',
      required: 'Enter business code, mobile number and PIN.',
      invalidMobile: 'Enter a valid 10-digit mobile number.',
      loading: 'Checking...',
      noPayments: 'No payment history found.'
    },
    hi: {
      portal: 'Customer Portal',
      title: 'अपना Payment Status देखें',
      subtitle: 'Business code, registered mobile number और portal PIN डालकर bill, paid amount और pending amount देखें.',
      businessCode: 'Business Code',
      mobile: 'Registered Mobile Number',
      pin: 'Portal PIN',
      check: 'Status देखें',
      privacy: 'Privacy के लिए यह page business द्वारा set किए गए portal PIN से ही खुलेगा.',
      staffLogin: 'Staff login',
      empty: 'आपकी secure summary यहाँ दिखेगी.',
      bill: 'Bill Amount',
      paid: 'Paid Amount',
      pending: 'Pending Amount',
      lastPayment: 'Last Payment',
      recent: 'Recent Payments',
      notFound: 'Matching record नहीं मिला. Business code, mobile number और PIN check करें.',
      required: 'Business code, mobile number और PIN डालें.',
      invalidMobile: 'कृपया मान्य 10 अंकों का मोबाइल नंबर डालें.',
      loading: 'Checking...',
      noPayments: 'Payment history नहीं मिली.'
    },
    gu: {
      portal: 'Customer Portal',
      title: 'તમારું Payment Status જુઓ',
      subtitle: 'Business code, registered mobile number અને portal PIN નાખીને bill, paid amount અને pending amount જુઓ.',
      businessCode: 'Business Code',
      mobile: 'Registered Mobile Number',
      pin: 'Portal PIN',
      check: 'Status જુઓ',
      privacy: 'Privacy માટે આ page business દ્વારા set કરેલા portal PIN થી જ ખુલશે.',
      staffLogin: 'Staff login',
      empty: 'તમારી secure summary અહીં દેખાશે.',
      bill: 'Bill Amount',
      paid: 'Paid Amount',
      pending: 'Pending Amount',
      lastPayment: 'Last Payment',
      recent: 'Recent Payments',
      notFound: 'Matching record મળ્યો નથી. Business code, mobile number અને PIN check કરો.',
      required: 'Business code, mobile number અને PIN નાખો.',
      invalidMobile: 'કૃપા કરીને સાચો 10 આંકડાનો મોબાઇલ નંબર નાખો.',
      loading: 'Checking...',
      noPayments: 'Payment history મળી નથી.'
    }
  };

  let lang = localStorage.getItem('rx_customer_lang') || 'en';

  function t(k) {
    return (dict[lang] && dict[lang][k]) || dict.en[k] || k;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function money(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN');
  }

  function dateText(d) {
    if (!d) return '-';
    try {
      return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return esc(d);
    }
  }

  function setLang(next) {
    lang = dict[next] ? next : 'en';
    localStorage.setItem('rx_customer_lang', lang);
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-lang]').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
  }

  function showError(msg) {
    const box = document.getElementById('errorBox');
    if (!box) return;
    box.textContent = msg;
    box.classList.add('show');
  }

  function clearError() {
    const box = document.getElementById('errorBox');
    if (!box) return;
    box.textContent = '';
    box.classList.remove('show');
  }

  function render(data) {
    const emptyState = document.getElementById('emptyState');
    const summary = document.getElementById('summary');
    if (emptyState) emptyState.style.display = 'none';
    if (summary) summary.classList.add('show');

    document.getElementById('customerName').textContent = data.customer_name || 'Customer';
    document.getElementById('businessName').textContent = data.business_name || '';
    document.getElementById('statusChip').textContent = data.status || 'Active';
    document.getElementById('billAmount').textContent = money(data.bill_amount);
    document.getElementById('paidAmount').textContent = money(data.paid_amount);
    document.getElementById('pendingAmount').textContent = money(data.pending_amount);
    document.getElementById('lastPayment').textContent = data.last_payment_date ? dateText(data.last_payment_date) : '-';

    const payments = Array.isArray(data.recent_payments) ? data.recent_payments : [];
    const paymentsList = document.getElementById('paymentsList');
    if (paymentsList) {
      paymentsList.innerHTML = payments.length
        ? payments.map(p => `
            <div class="row">
              <div>
                <strong>${money(p.amount)}</strong><br>
                <small>${dateText(p.date)} · ${esc(p.mode || '-')}</small>
              </div>
              <span>${esc(p.receipt_no || '')}</span>
            </div>
          `).join('')
        : `<p class="sub">${t('noPayments')}</p>`;
    }
  }

  async function lookup(event) {
    event.preventDefault();
    clearError();

    const summary = document.getElementById('summary');
    const emptyState = document.getElementById('emptyState');
    if (summary) summary.classList.remove('show');
    if (emptyState) emptyState.style.display = '';

    const shopCode = document.getElementById('shopCode').value.trim();
    const mobile = document.getElementById('mobile').value.trim();
    const pin = document.getElementById('pin').value.trim();

    if (!shopCode || !mobile || !pin) {
      showError(t('required'));
      return;
    }

    const cleanedMobile = mobile.replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(cleanedMobile)) {
      showError(t('invalidMobile'));
      return;
    }

    const btn = document.getElementById('checkBtn');
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = t('loading');

    try {
      const { data, error } = await getSupabase().rpc('app_customer_self_view', {
        p_shop_code: shopCode,
        p_mobile: cleanedMobile,
        p_pin: pin
      });

      if (error) throw error;
      if (!data || data.error) {
        showError(
          data?.error === 'temporarily_locked' ? 'Too many attempts. Try again after 15 minutes.' :
          data?.error === 'maintenance_mode' ? 'The system is under maintenance. Please try again later.' :
          t('notFound')
        );
        return;
      }
      render(data);
    } catch (e) {
      console.error(e);
      showError(String(e.message || e).includes('not_found') ? t('notFound') : 'Unable to load details. Please try again.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }

  document.querySelectorAll('[data-lang]').forEach(b => {
    b.addEventListener('click', () => setLang(b.dataset.lang));
  });

  const form = document.getElementById('portalForm');
  if (form) form.addEventListener('submit', lookup);

  setLang(lang);
})();
