import { Link } from 'react-router';
import { EmptyState } from '../ui/index.ts';

export function Component() {
  return (
    <EmptyState
      title="NO SUCH VIEW"
      detail="The requested route does not exist."
      action={
        <Link
          to="/"
          className="mnemonic border border-rule px-1.5 py-0.5 text-xs text-text hover:border-text-2"
        >
          RETURN TO FLEET
        </Link>
      }
    />
  );
}
