import type { Product } from '@workspace/api-client-react';

export function upsertProduct(current: readonly Product[] | undefined, saved: Product): Product[] {
  if (current?.some(product => product.id === saved.id)) {
    return current.map(product => product.id === saved.id ? saved : product);
  }
  return [saved, ...(current ?? [])];
}
