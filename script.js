// script.js
// Loads JSON data, parses variants, detects conflicts, and generates Odoo import plan.

// ==========================
// 1. GLOBALS
// ==========================
let material_master = [];
let price_sheet = [];

window.material_master = material_master;
window.price_sheet = price_sheet;

// ==========================
// 2. LOADERS
// ==========================
async function loadData() {
  if (material_master.length && price_sheet.length) return;

  const [mRes, pRes] = await Promise.all([
    fetch('material_master.json'),
    fetch('price_sheet.json')
  ]);

  if (!mRes.ok) {
    throw new Error('Failed to load material_master.json');
  }

  if (!pRes.ok) {
    throw new Error('Failed to load price_sheet.json');
  }

  material_master = await mRes.json();
  price_sheet = await pRes.json();

  window.material_master = material_master;
  window.price_sheet = price_sheet;
}

// ==========================
// 3. HELPERS
// ==========================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)
  );
}

function formatValue(val) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '0';
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => console.log('Copied to clipboard.'))
      .catch(err => console.warn('Clipboard copy failed.', err));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      console.log('Copied to clipboard.');
    } catch (err) {
      console.warn('Clipboard copy failed.', err);
    }
    ta.remove();
  }
}

// Placeholder mapping functions
function getProductTemplateId(model) {
  // TODO: Map model code to actual Odoo product.template ID.
  return null;
}

function getVariantId(model, code, config) {
  // TODO: Map (model+code+config) to actual Odoo variant ID.
  return null;
}

// ==========================
// 4. PARSER
// ==========================
function extractCode(fabricPart) {
  const text = String(fabricPart || '').trim().toUpperCase();

  const sortedCodes = material_master
    .map(m => String(m.code || '').trim().toUpperCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const code of sortedCodes) {
    if (
      text === code ||
      text.startsWith(code + '-') ||
      text.startsWith(code + ' ')
    ) {
      return code;
    }
  }

  return text.split('-')[0].trim();
}

function parseVariant(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid variant input');
  }

  try {
    input = input
      .replace(/\(\s*\(/g, '(')
      .replace(/\)\s*\)/g, ')')
      .trim();

    const brackets = input.match(/\(([^()]*)\)/g);

    if (!brackets || brackets.length < 2) {
      throw new Error('Invalid format');
    }

    // FIRST BRACKET
    // (DM)

    const prefix = brackets[0]
      .replace(/[()]/g, '')
      .trim();

    // MODEL SECTION
    // A6354

    const afterPrefix = input.split(')')[1].trim();

    const modelName = afterPrefix.split(' ')[0];

    const model = `${prefix}-${modelName}`;

    // LAST BRACKET
    // (PE-505E Elephant Grey, 1.5EL+1.5NA+1.5COUR)

    const last = brackets[brackets.length - 1]
      .replace(/[()]/g, '');

    let [fabricPart, configPart] = last.split(',');

    if (!fabricPart || !configPart) {
      throw new Error('Invalid fabric/config format');
    }

    configPart = configPart
      .replace(/[()]/g, '')
      .trim()
      .toUpperCase();

    const code = extractCode(fabricPart);

    return {
      model: model.trim(),
      code: code.trim(),
      config: configPart
    };
  } catch (err) {
    console.error('Parse failed:', input);
    throw err;
  }
}

// ==========================
// 5. ENGINE
// ==========================
function getGrade(code) {
  const item = material_master.find(
    m => String(m.code || '').trim().toUpperCase() === String(code || '').trim().toUpperCase()
  );

  if (!item) {
    throw new Error(`Invalid code: ${code}`);
  }

  return item.grade;
}

function getFinalPrice(model, config, grade) {
  const normalizedModel = String(model || '').trim();
  const normalizedConfig = String(config || '').trim().toUpperCase();
  const normalizedGrade = String(grade || '').trim();

  if (normalizedConfig.includes('+')) {
    return normalizedConfig.split('+').reduce((sum, part) => {
      const item = price_sheet.find(p =>
        String(p.model || '').trim() === normalizedModel &&
        String(p.config || '').trim().toUpperCase() === String(part || '').trim().toUpperCase() &&
        String(p.grade || '').trim() === normalizedGrade
      );

      if (!item) {
        throw new Error(`Missing part price: ${part}`);
      }

      return sum + Number(item.price);
    }, 0);
  }

  const item = price_sheet.find(p =>
    String(p.model || '').trim() === normalizedModel &&
    String(p.config || '').trim().toUpperCase() === normalizedConfig &&
    String(p.grade || '').trim() === normalizedGrade
  );

  if (!item) {
    throw new Error(`Price not found: ${model} | ${config} | ${grade}`);
  }

  return Number(item.price);
}

async function analyzeVariants() {
  await loadData();

  const inputEl = document.getElementById('inputBox') || document.getElementById('input');
  const inputText = inputEl ? (inputEl.value || '') : '';
  const lines = inputText.split('\n').filter(l => l.trim());

  const results = [];

  for (let line of lines) {
    try {
      const { model, code, config } = parseVariant(line);
      const grade = getGrade(code);
      const price = getFinalPrice(model, config, grade);
      results.push({ model, code, config, grade, price });
    } catch (err) {
      console.warn(`Line skipped (parse error): "${line}"`, err);
    }
  }

  return results;
}

// ==========================
// 6. UI
// ==========================
function findConflicts(variants) {
  const groups = {};

  variants.forEach(v => {
    const key = `${v.model}||${v.config}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(v);
  });

  const conflicts = [];

  for (let key in groups) {
    const group = groups[key];
    const uniquePrices = [...new Set(group.map(v => Number(v.price)))];

    if (uniquePrices.length > 1) {
      const [model, config] = key.split('||');
      conflicts.push({ model, config, variants: group });
    }
  }

  return conflicts;
}

function generatePlan(conflicts) {
  const attrEdits = [];
  const priceOverrides = [];

  conflicts.forEach(conf => {
    const { model, config, variants } = conf;

    // Attribute edit: set config extra to 0
    attrEdits.push({
      model: model,
      attribute: 'Configuration',
      value: config,
      extra: 0,
      exclude_for: [] // no excludes by default
    });

    // Variant pricelist rules
    variants.forEach(v => {
      const tmplId = getProductTemplateId(v.model) || 'MISSING_MAPPING';
      const varId = getVariantId(v.model, v.code, v.config) || 'MISSING_MAPPING';

      priceOverrides.push({
        model: v.model,
        code: v.code,
        config: v.config,
        product_template_id: tmplId,
        variant_id: varId,
        fixed_price: Number(v.price)
      });
    });
  });

  return { attrEdits, priceOverrides };
}

function renderResults(variants) {
  const outTbody = document.querySelector('#outputTable tbody') || document.querySelector('#output tbody');
  if (!outTbody) return;

  outTbody.innerHTML = '';

  variants.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(v.model)}</td>
      <td>${escapeHtml(v.code)}</td>
      <td>${escapeHtml(v.config)}</td>
      <td>${escapeHtml(v.grade)}</td>
      <td>${formatValue(v.price)}</td>
      <td></td>
    `;
    outTbody.appendChild(tr);
  });
}

function displayConflictTable(conflicts) {
  const tbody = document.querySelector('#conflictTable tbody') || document.getElementById('conflictTable');
  if (!tbody) return;

  tbody.innerHTML = '';

  conflicts.forEach(conf => {
    const codes = conf.variants.map(v => v.code).join(', ');
    const prices = conf.variants.map(v => formatValue(v.price)).join(' / ');
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(conf.model)}</td>
      <td>${escapeHtml(conf.config)}</td>
      <td>${escapeHtml(codes)}</td>
      <td>${escapeHtml(prices)}</td>
      <td>Base Extra=0 + variant pricelists</td>
    `;
    tbody.appendChild(row);
  });
}

function displayPayloadTable(attrEdits, priceOverrides) {
  const tbody = document.querySelector('#payloadTable tbody') || document.getElementById('payloadTable');
  if (!tbody) return;

  tbody.innerHTML = '';

  // Attribute edits
  attrEdits.forEach(a => {
    const cells = ['Attribute', a.model, a.value, a.extra, a.exclude_for.join(';')];
    const tr = document.createElement('tr');
    tr.innerHTML = cells.map(c => `<td>${escapeHtml(c)}</td>`).join('');
    tbody.appendChild(tr);
  });

  // Pricelist rules
  priceOverrides.forEach(p => {
    const idDisplay = p.variant_id === 'MISSING_MAPPING'
      ? `${p.model}|${p.code}|${p.config}`
      : p.variant_id;

    const cells = ['Pricelist', p.model, idDisplay, formatValue(p.fixed_price)];
    const tr = document.createElement('tr');
    tr.innerHTML = cells.map(c => `<td>${escapeHtml(c)}</td>`).join('');
    tbody.appendChild(tr);
  });
}

function copyCsv(attrEdits, priceOverrides) {
  let csv = 'Type,Model,Value,Extra/Price,Exclude/ID\n';

  attrEdits.forEach(a => {
    csv += `Attr,${a.model},${a.value},${a.extra},${a.exclude_for.join(';')}\n`;
  });

  priceOverrides.forEach(p => {
    const idVal = p.variant_id === 'MISSING_MAPPING'
      ? `${p.model}|${p.code}|${p.config}`
      : p.variant_id;

    csv += `Price,${p.model},${idVal},${p.fixed_price}\n`;
  });

  copyText(csv);

  const planOutput = document.getElementById('planOutput');
  if (planOutput) planOutput.value = csv;
}

function copyJson(attrEdits, priceOverrides) {
  const data = {
    attribute_edits: attrEdits,
    pricelist_items: priceOverrides
  };

  const jsonStr = JSON.stringify(data, null, 2);
  copyText(jsonStr);

  const planOutput = document.getElementById('planOutput');
  if (planOutput) planOutput.value = jsonStr;
}

function clearTables() {
  const outputBody = document.querySelector('#outputTable tbody') || document.querySelector('#output tbody');
  const conflictBody = document.querySelector('#conflictTable tbody') || document.getElementById('conflictTable');
  const payloadBody = document.querySelector('#payloadTable tbody') || document.getElementById('payloadTable');
  const planOutput = document.getElementById('planOutput');
  const inputBox = document.getElementById('inputBox') || document.getElementById('input');

  if (inputBox) inputBox.value = '';
  if (outputBody) outputBody.innerHTML = '';
  if (conflictBody) conflictBody.innerHTML = '';
  if (payloadBody) payloadBody.innerHTML = '';
  if (planOutput) planOutput.value = '';
}

// ==========================
// 7. EVENTS
// ==========================
document.addEventListener('DOMContentLoaded', () => {
  const runBtn = document.getElementById('runBtn');
  const clearBtn = document.getElementById('clearBtn');
  const copyCsvBtn = document.getElementById('copyCsvBtn');
  const copyJsonBtn = document.getElementById('copyJsonBtn');

  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      try {
        const variants = await analyzeVariants();

        if (!variants.length) {
          alert('No valid variant lines found.');
          return;
        }

        renderResults(variants);

        const conflicts = findConflicts(variants);
        displayConflictTable(conflicts);

        const plan = generatePlan(conflicts);
        displayPayloadTable(plan.attrEdits, plan.priceOverrides);

        if (copyCsvBtn) {
          copyCsvBtn.onclick = () => copyCsv(plan.attrEdits, plan.priceOverrides);
        }

        if (copyJsonBtn) {
          copyJsonBtn.onclick = () => copyJson(plan.attrEdits, plan.priceOverrides);
        }
      } catch (err) {
        console.error('Analysis failed:', err);
        alert(err.message || err);
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', clearTables);
  }
});
