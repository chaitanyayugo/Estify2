// script.js
// Loads JSON data, parses variants, detects conflicts, and generates Odoo import plan.

// ==========================
// 1. Load Data
// ==========================
let material_master = [], price_sheet = [];
async function loadData() {
  const [mRes, pRes] = await Promise.all([
    fetch('material_master.json'),
    fetch('price_sheet.json')
  ]);
  if (!mRes.ok || !pRes.ok) {
    console.error('Failed to load JSON data.');
    return;
  }
  material_master = await mRes.json();
  price_sheet = await pRes.json();
}

// ==========================
// 2. Helper Functions
// ==========================
function formatValue(val) {
  return (Math.round(val) || 0).toLocaleString();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => 
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] || c)
  );
}
function copyText(text) {
  navigator.clipboard.writeText(text)
    .then(()=> console.log('Copied to clipboard.'))
    .catch(err=> console.warn('Clipboard copy failed.', err));
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
// 3. Parse Input Variants
// ==========================
// Assume parseVariant, getGrade, getFinalPrice exist globally
async function analyzeVariants() {
  await loadData();
  const inputText = document.getElementById("inputBox").value || "";
  const lines = inputText.split("\\n").filter(l=>l.trim());
  const results = [];
  for (let line of lines) {
    try {
      const {model, code, config} = parseVariant(line);
      const grade = getGrade(code);
      const price = getFinalPrice(model, config, grade);
      results.push({model, code, config, grade, price});
    } catch (err) {
      console.warn(`Line skipped (parse error): "${line}"`, err);
    }
  }
  return results;
}

// ==========================
// 4. Detect Conflicts
// ==========================
function findConflicts(variants) {
  // Group by model+config
  const groups = {};
  variants.forEach(v => {
    const key = `${v.model}||${v.config}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(v);
  });
  // Filter groups with >1 distinct price
  const conflicts = [];
  for (let key in groups) {
    const group = groups[key];
    const uniquePrices = [...new Set(group.map(v=>v.price))];
    if (uniquePrices.length > 1) {
      const [model, config] = key.split("||");
      conflicts.push({model, config, variants: group});
    }
  }
  return conflicts;
}

// ==========================
// 5. Generate Fix Plan
// ==========================
function generatePlan(conflicts) {
  const attrEdits = [];
  const priceOverrides = [];

  conflicts.forEach(conf => {
    const {model, config, variants} = conf;
    // Attribute edit: set config extra to 0
    attrEdits.push({
      model: model,
      attribute: "Configuration",
      value: config,
      extra: 0,
      exclude_for: [] // no excludes by default
    });
    // Variant pricelist rules
    variants.forEach(v => {
      const tmplId = getProductTemplateId(v.model) || "MISSING_MAPPING";
      const varId = getVariantId(v.model, v.code, v.config) || "MISSING_MAPPING";
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

  return {attrEdits, priceOverrides};
}

// ==========================
// 6. Display Results & Copy
// ==========================
function displayConflictTable(conflicts) {
  const tbody = document.getElementById("conflictTable");
  tbody.innerHTML = "";
  conflicts.forEach(conf => {
    const codes = conf.variants.map(v=>v.code).join(", ");
    const prices = conf.variants.map(v=>formatValue(v.price)).join(" / ");
    const row = document.createElement("tr");
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
  const tbody = document.getElementById("payloadTable");
  tbody.innerHTML = "";
  // Attribute edits
  attrEdits.forEach(a => {
    const cells = [`Attribute`, a.model, a.value, a.extra, a.exclude_for.join(";")];
    const tr = document.createElement("tr");
    tr.innerHTML = cells.map(c => `<td>${escapeHtml(c)}</td>`).join("");
    tbody.appendChild(tr);
  });
  // Pricelist rules
  priceOverrides.forEach(p => {
    const idDisplay = p.variant_id === "MISSING_MAPPING" 
                      ? `${p.model}|${p.code}|${p.config}` 
                      : p.variant_id;
    const cells = [`Pricelist`, p.model, idDisplay, formatValue(p.fixed_price)];
    const tr = document.createElement("tr");
    tr.innerHTML = cells.map(c => `<td>${escapeHtml(c)}</td>`).join("");
    tbody.appendChild(tr);
  });
}

function copyCsv(attrEdits, priceOverrides) {
  // Build CSV
  let csv = "Type,Model,Value,Extra/Price,Exclude/ID\n";
  attrEdits.forEach(a => {
    csv += `Attr,${a.model},${a.value},${a.extra},${a.exclude_for.join(";")}\n`;
  });
  priceOverrides.forEach(p => {
    const idVal = p.variant_id === "MISSING_MAPPING" 
                  ? `${p.model}|${p.code}|${p.config}` 
                  : p.variant_id;
    csv += `Price,${p.model},${idVal},${p.fixed_price}\n`;
  });
  copyText(csv);
  document.getElementById("planOutput").textContent = csv;
}

function copyJson(attrEdits, priceOverrides) {
  const data = {attribute_edits: attrEdits, pricelist_items: priceOverrides};
  const jsonStr = JSON.stringify(data, null, 2);
  copyText(jsonStr);
  document.getElementById("planOutput").textContent = jsonStr;
}

// ==========================
// 7. Run Analysis Handler
// ==========================
document.getElementById("runBtn").onclick = async () => {
  const variants = await analyzeVariants();
  if (!variants.length) {
    alert("No valid variant lines found.");
    return;
  }
  // Populate results table
  const outTbody = document.querySelector("#outputTable tbody");
  outTbody.innerHTML = "";
  variants.forEach(v => {
    const tr = document.createElement("tr");
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
  // Find conflicts and display
  const conflicts = findConflicts(variants);
  displayConflictTable(conflicts);
  // Generate plan and display payloads
  const plan = generatePlan(conflicts);
  displayPayloadTable(plan.attrEdits, plan.priceOverrides);
  
  // Setup copy buttons
  document.getElementById("copyCsvBtn").onclick = () => copyCsv(plan.attrEdits, plan.priceOverrides);
  document.getElementById("copyJsonBtn").onclick = () => copyJson(plan.attrEdits, plan.priceOverrides);
};

document.getElementById("clearBtn").onclick = () => {
  document.getElementById("inputBox").value = "";
  document.querySelector("#outputTable tbody").innerHTML = "";
  document.getElementById("planOutput").textContent = "";
  document.getElementById("conflictTable").innerHTML = "";
  document.getElementById("payloadTable").innerHTML = "";
};
