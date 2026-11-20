import { Component } from '@theme/component';
import { formatMoney } from '@theme/money-formatting';
import { StandardEvents } from '@shopify/events';
import {
  findVariantByOptions,
  getSelectedOptionValues,
  selectVariantOptions,
  updateOptionAvailability,
} from '@theme/variant-option-buttons';

/**
 * @typedef {{ id: number, options: string[], price: number, available: boolean }} BundleVariant
 * @typedef {{ variantId: string, quantity: number }} BundleCartItem
 */

/**
 * "Buy more, save more" tiers. Tier 1 follows the main variant picker; larger tiers pick a
 * variant per item. The section's product form reads `getCartItems()` on submit.
 *
 * @typedef {Object} Refs
 * @property {HTMLScriptElement} variantsData
 * @property {HTMLInputElement[]} tierInputs
 * @property {HTMLElement[]} [tierPrices]
 * @property {HTMLElement[]} [tierCompares]
 * @property {HTMLElement[]} [items]
 * @property {HTMLElement} [status]
 *
 * @extends {Component<Refs>}
 */
export class BundleOfferComponent extends Component {
  requiredRefs = ['variantsData', 'tierInputs'];

  /** @type {BundleVariant[]} */
  #variants = [];

  /** @type {AbortController | undefined} */
  #abortController;

  connectedCallback() {
    super.connectedCallback();

    try {
      this.#variants = JSON.parse(this.refs.variantsData.textContent || '[]');
    } catch (error) {
      this.#variants = [];
    }

    this.#abortController?.abort();
    this.#abortController = new AbortController();
    this.closest('.shopify-section')?.addEventListener(StandardEvents.productSelect, this.#onProductSelect, {
      signal: this.#abortController.signal,
    });

    this.#update();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController?.abort();
  }

  /** @param {Event} event */
  handleTierChange(event) {
    if (this.refs.status) this.refs.status.textContent = '';
    this.#update();
  }

  /** @param {Event} event */
  handleItemChange(event) {
    const item = event.target instanceof Element ? event.target.closest('.bundle-offer__item') : null;
    if (item instanceof HTMLElement) item.dataset.touched = 'true';
    if (this.refs.status) this.refs.status.textContent = '';
    this.#update();
  }

  /**
   * Items to add for the selected tier. Returns null when tier 1 is selected so the product
   * form keeps its regular single-variant flow, and an empty array when an item is unavailable.
   * @returns {BundleCartItem[] | null}
   */
  getCartItems() {
    const tier = this.#getActiveTier();
    if (!tier || tier.quantity <= 1) return null;

    const variants = this.#getTierVariants(tier.container, tier.quantity);
    const invalidIndex = variants.findIndex((variant) => !variant?.available);

    if (invalidIndex !== -1) {
      const item = this.#getItems(tier.container)[invalidIndex];
      item?.querySelector('input[type="radio"]:checked, input[type="radio"]')?.focus();
      if (this.refs.status) this.refs.status.textContent = this.dataset.unavailableMessage ?? '';
      return [];
    }

    /** @type {Map<string, number>} */
    const quantities = new Map();
    for (const variant of variants) {
      if (!variant) continue;
      const id = String(variant.id);
      quantities.set(id, (quantities.get(id) ?? 0) + 1);
    }

    return Array.from(quantities, ([variantId, quantity]) => ({ variantId, quantity }));
  }

  /** @param {Event} event */
  #onProductSelect = async (event) => {
    const sourceCard = event.target instanceof Element ? event.target.closest('product-card') : null;
    if (sourceCard && !sourceCard.contains(this)) return;

    /** @type {{ detail?: { productId?: string, resource?: { id?: number } } } | undefined} */
    let result;
    try {
      result = await /** @type {any} */ (event).promise;
    } catch (error) {
      return;
    }

    const { productId, resource } = result?.detail ?? {};
    if (productId && productId !== this.dataset.productId) return;
    if (!resource?.id) return;

    this.dataset.variantId = String(resource.id);

    // Untouched item rows follow the main picker so the bundle starts from the shopper's choice.
    const variant = this.#findVariantById(resource.id);
    if (variant) {
      for (const item of this.#getItems(this)) {
        if (item.dataset.touched !== 'true') selectVariantOptions(item, variant);
      }
    }

    this.#update();
  };

  #update() {
    const { tierInputs, tierPrices = [], tierCompares = [] } = this.refs;
    const active = this.#getActiveTier();
    this.dataset.activeQuantity = String(active?.quantity ?? 1);

    let compareIndex = 0;
    tierInputs.forEach((input, index) => {
      const quantity = Number(input.value);
      const discount = Number(input.dataset.discount) || 0;
      const container = input.closest('.bundle-offer__tier');
      const variants =
        quantity > 1 && container instanceof HTMLElement
          ? this.#getTierVariants(container, quantity)
          : Array.from({ length: quantity }, () => this.#findVariantById(this.dataset.variantId));

      for (const [itemIndex, item] of this.#getItems(container).entries()) {
        const error = item.querySelector('.bundle-offer__item-error');
        if (error instanceof HTMLElement) error.hidden = Boolean(variants[itemIndex]?.available);
        updateOptionAvailability(item, this.#variants);
      }

      const total = variants.reduce((sum, variant) => sum + (variant?.price ?? 0), 0);
      const discounted = Math.round((total * (100 - discount)) / 100);

      this.#setMoney(tierPrices[index], discounted);
      if (discount > 0) this.#setMoney(tierCompares[compareIndex++], total);
    });
  }

  /** @returns {{ quantity: number, container: HTMLElement } | null} */
  #getActiveTier() {
    const input = this.refs.tierInputs.find((tierInput) => tierInput.checked);
    const container = input?.closest('.bundle-offer__tier');
    if (!input || !(container instanceof HTMLElement)) return null;
    return { quantity: Number(input.value), container };
  }

  /**
   * @param {Element | null} container
   * @returns {HTMLElement[]}
   */
  #getItems(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('.bundle-offer__item')).filter(
      (item) => item instanceof HTMLElement
    );
  }

  /**
   * @param {HTMLElement} container
   * @param {number} quantity
   * @returns {(BundleVariant | undefined)[]}
   */
  #getTierVariants(container, quantity) {
    const items = this.#getItems(container);

    // Products without options render item labels only; every item is the selected variant.
    if (items.length === 0 || !items[0]?.querySelector('[data-option-position]')) {
      return Array.from({ length: quantity }, () => this.#findVariantById(this.dataset.variantId));
    }

    return items.map((item) => findVariantByOptions(this.#variants, getSelectedOptionValues(item)));
  }

  /**
   * @param {string | number | undefined} id
   * @returns {BundleVariant | undefined}
   */
  #findVariantById(id) {
    return this.#variants.find((variant) => String(variant.id) === String(id));
  }

  /**
   * @param {HTMLElement | undefined} element
   * @param {number} amount
   */
  #setMoney(element, amount) {
    const bdi = element?.querySelector('bdi');
    if (!bdi) return;
    bdi.textContent = formatMoney(amount, this.dataset.moneyFormat ?? '{{amount}}', this.dataset.currency ?? 'USD');
  }
}

if (!customElements.get('bundle-offer-component')) {
  customElements.define('bundle-offer-component', BundleOfferComponent);
}
