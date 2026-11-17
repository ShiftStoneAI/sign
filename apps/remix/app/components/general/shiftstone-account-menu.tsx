import { authClient } from '@documenso/auth/client';
import { useSession } from '@documenso/lib/client-only/providers/session';
import { formatAvatarUrl } from '@documenso/lib/utils/avatars';
import { env } from '@documenso/lib/utils/env';
import { isAdmin } from '@documenso/lib/utils/is-admin';
import { extractInitials } from '@documenso/lib/utils/recipient-formatter';
import { canExecuteTeamAction } from '@documenso/lib/utils/teams';
import { AvatarWithText } from '@documenso/ui/primitives/avatar';
import { Button } from '@documenso/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';
import { Trans } from '@lingui/react/macro';
import { ArrowLeftIcon, ChevronsUpDown } from 'lucide-react';
import { Link } from 'react-router';

import { useOptionalCurrentTeam } from '~/providers/team';

/**
 * Shiftstone (Wen, 2026-11-16): one company, one team, so the account menu replaces Documenso's organisation and
 * team switcher (OrgMenuSwitcher, left in place for upstream merges). No organisations, teams or plans to pick.
 */
export const ShiftstoneAccountMenu = () => {
  const { user, organisations } = useSession();
  const currentTeam = useOptionalCurrentTeam();
  const team = currentTeam ?? organisations.flatMap((o) => o.teams)[0];
  const admin = (env('NEXT_PUBLIC_SHIFTSTONE_ADMIN_URL') || 'https://admin.shiftstone.ai').replace(/\/+$/, '');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="menu-switcher"
          variant="none"
          className="relative flex h-12 flex-row items-center px-0 py-2 ring-0 focus:outline-none focus-visible:border-0 focus-visible:ring-0 focus-visible:ring-transparent md:px-2"
        >
          <AvatarWithText
            avatarSrc={formatAvatarUrl(user.avatarImageId)}
            avatarFallback={extractInitials(user.name || user.email)}
            primaryText={user.name || user.email}
            secondaryText={team?.name ?? 'Shiftstone'}
            rightSideComponent={<ChevronsUpDown className="ml-auto h-4 w-4 text-muted-foreground" />}
            textSectionClassName="hidden lg:flex"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="z-[60] w-56" align="end" forceMount>
        <DropdownMenuItem asChild>
          <a href={`${admin}/admin`}>
            <ArrowLeftIcon className="mr-2 h-4 w-4" />
            <Trans>Back to the admin</Trans>
          </a>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to="/inbox">
            <Trans>Inbox</Trans>
          </Link>
        </DropdownMenuItem>

        {team && canExecuteTeamAction('MANAGE_TEAM', team.currentTeamRole) && (
          <DropdownMenuItem asChild>
            <Link to={`/t/${team.url}/settings/general`}>
              <Trans>Team settings</Trans>
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem asChild>
          <Link to="/settings/profile">
            <Trans>Account</Trans>
          </Link>
        </DropdownMenuItem>

        {isAdmin(user) && (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <Trans>Site admin</Trans>
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={async () => authClient.signOut({ redirectPath: `${admin}/admin` })}>
          <Trans>Sign out of Sign</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
