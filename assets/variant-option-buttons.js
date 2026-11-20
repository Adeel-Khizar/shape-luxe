// Helpers for the `variant-option-buttons` snippet: read the chosen values, resolve the
// variant, and mark values with no available variant for the other selections.

/**
 * @typedef {{ id: number, options: string[], price: number, available: boolean }} OptionVariant
 */

/**
 * Selected option values ordered by option position.
 * @param {Element} container
 * @returns {(string | undefined)[]}
 */
export function getSelectedOptionValues(container) {
  /** @type {(string | undefined)[]} */
  const values = [];

  for (const fieldset of container.querySelectorAll('fieldset[data-option-position]')) {
    const index = Number(fieldset.getAttribute('data-option-position')) - 1;
    const checked = fieldset.querySelector('input[type="radio"]:checked');
    values[index] = checked instanceof HTMLInputElement ? checked.value : undefined;
  }

  return values;
}

/**
 * @param {OptionVariant[]} variants
 * @param {(string | undefined)[]} values
 * @returns {OptionVariant | undefined}
 */
export function findVariantByOptions(variants, values) {
  return variants.find((variant) => variant.options.every((option, i) => option === values[i]));
}

/**
 * Checks the radios matching a variant's options.
 * @param {Element} container
 * @param {OptionVariant} variant
 */
export function selectVariantOptions(container, variant) {
  for (const fieldset of container.querySelectorAll('fieldset[data-option-position]')) {
    const value = variant.options[Number(fieldset.getAttribute('data-option-position')) - 1];
    if (value === undefined) continue;

    for (const radio of fieldset.querySelectorAll('input[type="radio"]')) {
      if (radio instanceof HTMLInputElement) radio.checked = radio.value === value;
    }
  }
}

/**
 * Updates the swatch value labels and strikes through values with no available variant.
 * @param {Element} container
 * @param {OptionVariant[]} variants
 */
export function updateOptionAvailability(container, variants) {
  const values = getSelectedOptionValues(container);

  for (const fieldset of container.querySelectorAll('fieldset[data-option-position]')) {
    const index = Number(fieldset.getAttribute('data-option-position')) - 1;
    const label = fieldset.querySelector('[data-option-selected-value]');
    if (label) label.textContent = values[index] ?? '';

    for (const radio of fieldset.querySelectorAll('input[type="radio"]')) {
      if (!(radio instanceof HTMLInputElement)) continue;

      const available = variants.some(
        (variant) =>
          variant.available &&
          variant.options.every((option, i) => (i === index ? option === radio.value : option === values[i]))
      );
      radio.dataset.optionAvailable = String(available);
    }
  }
}
