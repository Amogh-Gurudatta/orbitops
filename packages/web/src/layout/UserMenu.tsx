// Signed-in user and role, with the guided-tour launcher and sign-out.
import { useNavigate } from 'react-router';
import { useSession } from '../auth/AuthContext.tsx';
import { useTour } from '../features/tour/tourContext.ts';
import { Icon, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Tag } from '../ui/index.ts';

export function UserMenu() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const { startTour } = useTour();
  if (!user) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="mnemonic flex h-3 items-center gap-1 border border-rule px-1 text-xs text-text-2 hover:border-text-2 data-[state=open]:border-select"
          aria-label={`Account: ${user.name}, role ${user.role}`}
        >
          <Icon name="user" size={14} />
          <span className="hidden max-w-24 truncate md:inline">{user.name}</span>
          <Tag className="hidden sm:inline-flex">{user.role}</Tag>
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{user.email}</MenuLabel>
        <MenuItem onSelect={startTour}>
          <Icon name="orbit" size={14} />
          START GUIDED TOUR
        </MenuItem>
        <MenuItem
          danger
          onSelect={() => {
            void logout().then(() => navigate('/login', { replace: true }));
          }}
        >
          <Icon name="logout" size={14} />
          SIGN OFF
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
