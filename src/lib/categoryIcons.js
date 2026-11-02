// One icon per category, used in the Home "Where it went" bars and category chips.
import { Briefcase, Car, Landmark, Pill, Receipt, ShoppingBag, ShoppingCart, Utensils, Zap } from 'lucide-react';

export const CATEGORY_ICONS = {
  'Food & Dining': Utensils,
  Groceries: ShoppingCart,
  Medicine: Pill,
  'Utilities & Telecom': Zap,
  Transport: Car,
  'Retail/Shopping': ShoppingBag,
  'Business Expense': Briefcase,
  'Government/Public': Landmark,
  Other: Receipt,
};

/** Short names for chips ("Retail" for "Retail/Shopping"). */
export const CATEGORY_SHORT = {
  'Retail/Shopping': 'Retail',
  'Utilities & Telecom': 'Utilities',
  'Business Expense': 'Business',
  'Government/Public': 'Government',
};
