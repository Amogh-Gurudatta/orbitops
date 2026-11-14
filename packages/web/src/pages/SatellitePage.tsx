import { useParams } from 'react-router';
import { Placeholder } from './Placeholder.tsx';

export function Component() {
  const { satId } = useParams();
  return (
    <Placeholder
      code="SAT"
      title={`Satellite ${satId ?? ''}`}
      note="strip charts, range picker, passes, command panel"
    />
  );
}
