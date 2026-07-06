import type { Product } from './products.js';

export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type Order = {
  id: string;
  userId: string;
  product: Product;
  status: OrderStatus;
  paymentId?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  createdAt: string;
  updatedAt: string;
};

const orders = new Map<string, Order>();

export function createOrder(input: Omit<Order, 'createdAt' | 'updatedAt' | 'status'>): Order {
  const now = new Date().toISOString();
  const order: Order = { ...input, status: 'pending', createdAt: now, updatedAt: now };
  orders.set(order.id, order);
  return order;
}

export function getOrder(orderId: string): Order | undefined {
  return orders.get(orderId);
}

export function findOrderByPaymentId(paymentId: string): Order | undefined {
  return [...orders.values()].find((order) => order.paymentId === paymentId);
}

export function updateOrder(orderId: string, patch: Partial<Order>): Order | undefined {
  const current = orders.get(orderId);
  if (!current) return undefined;

  const updated: Order = { ...current, ...patch, updatedAt: new Date().toISOString() };
  orders.set(orderId, updated);
  return updated;
}
