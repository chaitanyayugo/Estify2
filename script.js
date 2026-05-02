// ==Snippet Start==
// Assumes your existing ESTIFY functions (parseVariant, getGrade, getFinalPrice, loadData, runCalculator) are loaded.

// MAIN FUNCTION: Analyze variants and generate override plan
async function generateVariantPricingOverrides() {
  try {
    // 1. Load the JSON data (no changes to format)
    await loadData();

    // 2. Get all variants parsed by your logic
    const inputText = document.getElementById("input").value || "";
    const lines = inputText.split("\n").filter(l => l.trim() !== "");
    const variants = [];

    for (let line of lines) {
      try {
        const parsed = parseVariant(line);
        const grade = getGrade(parsed.code);
        const price = getFinalPrice(parsed.model, parsed.config, grade);
        variants.push({ ...parsed, grade, price });
      } catch (e) {
        console.warn(`Parsing/skipped: "${line.trim()}"  (Error: ${e})`);
      }
    }

    // 3. Group by model + config to detect conflicts
    const grouped = {};
    variants.forEach(v => {
      const key = `${v.model}__${v.config}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(v);
    });

    // 4. Find conflicts: same model/config, multiple distinct prices
    const conflicts = [];
    for (let key in grouped) {
      const group = grouped[key];
      const prices = Array.from(new Set(group.map(v => Number(v.price))));
      if (prices.length > 1) {
        const [model, config] = key.split("__");
        conflicts.push({ model, config, variants: group });
      }
    }

    // 5. Build override plan: attribute value edits + pricelist rules
    const attributeEdits = [];
    const pricelistRules = [];

    conflicts.forEach(conflict => {
      const { model, config, variants } = conflict;
      // Strategy: set config extra = 0 for base, then override each variant
      // (Assume base price = smallest price variant, but for simplicity we set extra=0 and use pricelist for actual prices)
      // 5a. Attribute value update for this configuration (value extra = 0)
      attributeEdits.push({
        model,
        attribute: "Configuration",
        value: config,
        extra_price: 0,
        exclude_for: []  // we could exclude from some product if needed (requires product_template_id mapping)
      });
      // 5b. Pricelist rules for each variant in the conflict
      variants.forEach(v => {
        // Placeholder mapping functions - replace with actual mapping logic or IDs
        const productTmplId = getProductTemplateId(v.model); // USER: implement mapping
        const variantId = getVariantId(v.model, v.code, v.config); // USER: implement mapping
        if (variantId == null) {
          console.warn(`Missing variant mapping for ${v.model} | ${v.code} | ${v.config}`);
        }
        // For fixed price, we use pricelist rule with variant ID (or SKU) and fixed price = v.price
        pricelistRules.push({
          product_template_id: productTmplId || "MISSING_MAPPING",
          product_variant_id: variantId || "MISSING_MAPPING",
          variant_code: `${v.model}|${v.code}|${v.config}`,  // for reference
          fixed_price: Number(v.price)
        });
      });
    });

    // 6. Conflict Summary Table (Model, Config, Codes, Prices, Strategy)
    console.log("Conflict Summary:");
    conflicts.forEach(conf => {
      const codes = conf.variants.map(v => v.code).join(" / ");
      const prices = conf.variants.map(v => formatValue(v.price)).join(" / ");
      console.table([{ 
        Model: conf.model, 
        Config: conf.config, 
        Codes: codes, 
        Prices: prices, 
        Strategy: "Shared config = 0 + pricelist overrides" 
      }]);
    });

    // 7. Prepare export text for attribute edits and pricelist rules
    const attrCsv = [
      ["Model","Attribute","Value","Extra Price","Exclude For (Template IDs)"]
    ];
    attributeEdits.forEach(a => {
      attrCsv.push([
        a.model,
        a.attribute,
        a.value,
        a.extra_price,
        a.exclude_for.join(";") || ""
      ]);
    });
    const plCsv = [
      ["Product Template ID","Variant ID or SKU","Fixed Price"]
    ];
    pricelistRules.forEach(p => {
      plCsv.push([
        p.product_template_id,
        p.product_variant_id !== "MISSING_MAPPING" ? p.product_variant_id : p.variant_code,
        p.fixed_price
      ]);
    });

    const attrCsvText = attrCsv.map(r => r.join(",")).join("\n");
    const plCsvText = plCsv.map(r => r.join(",")).join("\n");
    const exportText = 
      "# -- ATTRIBUTE VALUE UPDATES (CSV) --\n" + attrCsvText + "\n\n" +
      "# -- VARIANT PRICELIST RULES (CSV) --\n" + plCsvText;

    // 8. Copy export text to clipboard
    if (exportText) {
      copyText(exportText);
      console.log("Odoo override plan (CSV) copied to clipboard. Preview below:");
      console.log(exportText);
    } else {
      console.warn("No conflicts detected; nothing to export.");
    }

  } catch (err) {
    console.error("Error in generateVariantPricingOverrides:", err);
  }
}

// Helper stubs for ID mapping - replace with your actual logic
function getProductTemplateId(model) {
  // Example: map model name to Odoo product.template ID
  // Return null if unknown, to flag MISSING_MAPPING
  return null;
}
function getVariantId(model, code, config) {
  // Example: map specific variant (model+code+config) to Odoo product.variant ID
  return null;
}

// Use the same clipboard copy from ESTIFY (alert suppressed in console)
function copyText(text) {
  navigator.clipboard.writeText(text)
    .then(() => console.log("Copied plan to clipboard"))
    .catch(() => console.warn("Clipboard copy failed; manually copy from console"));
}

// Run the generator (you can also tie this to a button)
generateVariantPricingOverrides();

// ==Snippet End==
