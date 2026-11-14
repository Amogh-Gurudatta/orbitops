// Entry point: fonts, theme, providers (query cache, auth, tooltips), router, toaster.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import '@fontsource/b612/400.css';
import '@fontsource/b612/700.css';
import '@fontsource/b612-mono/400.css';
import '@fontsource/b612-mono/700.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import './styles/theme.css';
import { AuthProvider } from './auth/AuthContext.tsx';
import { queryClient } from './queryClient.ts';
import { router } from './router.tsx';
import { IconSprite, TooltipProvider } from './ui/index.ts';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <IconSprite />
          <RouterProvider router={router} />
          <Toaster position="bottom-right" toastOptions={{ unstyled: true }} visibleToasts={4} />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
