import { createFileRoute } from '@tanstack/react-router';
import { ProfitabilityScreen } from '@/components/admin/profitability/ProfitabilityScreen';
import { StartAdminViewError } from '../admin/AdminBoundaries';

export const Route = createFileRoute('/admin/marketing/profitability/transactions')({
  component: () => <ProfitabilityScreen detailPage />,
  errorComponent: StartAdminViewError,
});
