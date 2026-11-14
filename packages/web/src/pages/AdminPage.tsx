// Administration (admin only; the route guard lives in router.tsx): operator accounts and device keys.
import { DevicesPanel } from '../features/admin/DevicesPanel.tsx';
import { UsersPanel } from '../features/admin/UsersPanel.tsx';

export function Component() {
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-1 xl:grid-cols-2 [&>*]:min-h-[480px] xl:[&>*]:min-h-0">
      <UsersPanel />
      <DevicesPanel />
    </div>
  );
}
