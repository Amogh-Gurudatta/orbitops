// Alerts: virtualized alarm log with filters, ack / resolve and the rule editor.
import { useState } from 'react';
import { useSession } from '../auth/AuthContext.tsx';
import { AlarmsView } from '../features/alerts/AlarmsView.tsx';
import { AlertSummaryLine } from '../features/alerts/AlertSummaryLine.tsx';
import { RulesTable } from '../features/alerts/RulesTable.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/index.ts';

export function Component() {
  const { can } = useSession();
  const [tab, setTab] = useState('alarms');
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-2 border-b border-rule">
        <TabsList className="border-b-0">
          <TabsTrigger value="alarms">ALARMS</TabsTrigger>
          <TabsTrigger value="rules">RULES</TabsTrigger>
        </TabsList>
        <AlertSummaryLine />
      </div>
      <TabsContent
        value="alarms"
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <AlarmsView />
      </TabsContent>
      <TabsContent
        value="rules"
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        <RulesTable canEdit={can('admin')} />
      </TabsContent>
    </Tabs>
  );
}
