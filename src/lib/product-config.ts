export type ProductConfig = {
  name: string;
  supportUrl: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
};

function optional(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export const productConfig: ProductConfig = Object.freeze({
  name: optional(import.meta.env.VITE_PRODUCT_NAME) || 'SQL Academy',
  supportUrl: optional(import.meta.env.VITE_SUPPORT_URL),
  termsUrl: optional(import.meta.env.VITE_TERMS_URL),
  privacyUrl: optional(import.meta.env.VITE_PRIVACY_URL)
});
