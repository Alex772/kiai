export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  deliveryMessage: string;
};

export const products: Product[] = [
  {
    id: 'vip_bronze',
    name: 'VIP Bronze',
    description: 'Acesso VIP inicial por 30 dias.',
    price: 9.9,
    deliveryMessage: 'Obrigado pela compra do VIP Bronze! Abra um ticket caso precise ativar benefícios manuais.'
  },
  {
    id: 'vip_prata',
    name: 'VIP Prata',
    description: 'Acesso VIP intermediário por 30 dias.',
    price: 19.9,
    deliveryMessage: 'Obrigado pela compra do VIP Prata! Abra um ticket caso precise ativar benefícios manuais.'
  },
  {
    id: 'vip_ouro',
    name: 'VIP Ouro',
    description: 'Acesso VIP premium por 30 dias.',
    price: 29.9,
    deliveryMessage: 'Obrigado pela compra do VIP Ouro! Abra um ticket caso precise ativar benefícios manuais.'
  }
];

export function findProduct(productId: string): Product | undefined {
  return products.find((product) => product.id === productId);
}
