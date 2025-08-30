"use client";

import React, { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/app/components/Header';
import { useBusinessContext } from '@/app/lib/context/BusinessContext';
import { useUserContext } from '@/app/lib/context/UserContext';
import { Loader2, Settings, Package, RadioTower, LayoutDashboard, Users, ShoppingCart, Briefcase, PlusCircle, MessageSquare } from 'lucide-react';

// SidebarLink component definition
const SidebarLink = ({ 
  id, 
  href, 
  icon: Icon, 
  label, 
  activeSectionId,
  onClick 
}: { 
  id: string, 
  href: string, 
  icon: React.ElementType, 
  label: string, 
  activeSectionId: string, 
  onClick?: () => void;
}) => {
  const isActive = activeSectionId === id;

  return (
    <Link href={href} scroll={false} onClick={onClick}> {/* scroll is false for page links by default */}
      <div
        className={`flex items-center space-x-3 p-3 rounded-md cursor-pointer transition-colors duration-150
                    ${isActive ? 'bg-[var(--color-accent-primary)] text-white' : 'hover:bg-[var(--bg-accent)] text-[var(--text-on-dark-secondary)] hover:text-[var(--text-on-dark-primary)]'}`}
      >
        <Icon className="h-5 w-5" />
        <span>{label}</span>
      </div>
    </Link>
  );
};

export default function BusinessDetailLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const businessId = params.businessId as string;

  const { business, fetchBusiness, businessLoading, businessError } = useBusinessContext();
  const { user, user_loading, FUser } = useUserContext(); // FUser for checking auth

  const [activeSectionId, setActiveSectionId] = useState('info'); 
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (businessId && FUser && (!business || business.businessId !== businessId)) { 
      fetchBusiness(businessId, { include: 'user' }); 
    }
  }, [businessId, FUser, fetchBusiness, business]);

  // Define sidebar items with unique IDs and correct hrefs
  const sidebarItems = React.useMemo(() => [
    { id: 'info', label: 'Information', icon: LayoutDashboard, href: `/business/${businessId}`, exactMatch: true },
    { id: 'channels', label: 'Channels', icon: RadioTower, href: `/business/${businessId}/channels` },
    { id: 'products-overview', label: 'Products', icon: Package, href: `/business/${businessId}/products` },
    { id: 'new-product', label: 'Add Product', icon: PlusCircle, href: `/business/${businessId}/products/new`, parentSectionId: 'products-overview' },
    { id: 'customers', label: 'Customers', icon: Users, href: `/business/${businessId}/customers` }, 
    { id: 'chats', label: 'Chats', icon: MessageSquare, href: `/business/${businessId}/chats` },
    { id: 'orders', label: 'Orders', icon: ShoppingCart, href: `/business/${businessId}/orders` }, 
    { id: 'settings', label: 'Settings', icon: Settings, href: `/business/${businessId}/settings` },
  ], [businessId]);
  
  useEffect(() => {
    const currentPath = pathname;
    let newActiveId = 'info'; // Default

    const reversedSidebarItems = [...sidebarItems].reverse();

    for (const item of reversedSidebarItems) {
      if (item.exactMatch) {
        if (currentPath === item.href) {
            newActiveId = item.id;
            break; 
        }
      } else if (currentPath.startsWith(item.href)) {
        newActiveId = item.id;
        // If this item has a parentSectionId, we want the parent to be active.
        if (item.parentSectionId) {
          newActiveId = item.parentSectionId;
        }
        break; // Found the most specific match or its parent
      }
    }
    
    // Fallback for the main business page if no other match and path is exactly businessId page
    if (currentPath === `/business/${businessId}`) {
        newActiveId = 'info';
    }

    setActiveSectionId(newActiveId);

  }, [pathname, businessId, sidebarItems]);

  // Removed the separate useEffect for hashchange as all relevant links are page links.

  if (user_loading || (businessLoading && !business && businessId)) {
    return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-on-dark-primary)] flex flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-[var(--icon-accent-primary)]" />
        <p className="mt-4 text-lg">Loading Business Layout...</p>
      </div>
    );
  }

  if (!FUser && !user_loading) { // Check FUser for authentication
    router.push('/user/signIn'); 
    return null;
  }
  
  if (businessId && businessError && !business) {
     return (
      <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-on-dark-primary)] flex flex-col">
        <Header /> 
        <div className="flex-1 flex flex-col items-center justify-center p-4">
            <Briefcase className="h-16 w-16 text-[var(--text-error)] mb-4" />
            <h2 className="text-2xl font-semibold mb-2 text-[var(--text-error)]">Error Loading Business Information</h2>
            <p className="text-center text-[var(--text-on-dark-muted)] mb-6">{businessError || "The business could not be loaded. It might not exist or you may not have access."}</p>
            <Link href="/home" className="px-4 py-2 bg-[var(--color-accent-primary)] text-white rounded-md hover:bg-opacity-80 transition-colors">
            Go to Home
            </Link>
        </div>
      </div>
    );
  }

  const showAddProductButtonInMain = activeSectionId === 'products-overview' ;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-on-dark-primary)]">
      <Header 
        isSidebarOpen={isMobileSidebarOpen}
        onToggleSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        showToggleButton={!!businessId} 
      />
      <div className="flex flex-col md:flex-row relative">
        {businessId && ( 
          <aside
            className={`
              fixed inset-y-0 left-0 z-30 w-64 bg-[var(--bg-secondary)] p-4 space-y-2 transform
              md:sticky md:top-[var(--header-height,64px)] md:translate-x-0 md:min-h-[calc(100vh-var(--header-height,64px))]
              transition-transform duration-300 ease-in-out overflow-y-auto
              ${isMobileSidebarOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'}
            `}
            style={{ top: 'var(--header-height, 64px)' }} 
          >
            {sidebarItems.map(item => (
              <SidebarLink 
                key={item.id} 
                id={item.id}
                href={item.href} // All items use item.href directly
                icon={item.icon} 
                label={item.label} 
                activeSectionId={activeSectionId}
                onClick={() => {
                  if (isMobileSidebarOpen) setIsMobileSidebarOpen(false);
                }}
              />
            ))}
          </aside>
        )}
        <main className={`flex-1 p-4 md:p-8 overflow-y-auto transition-all duration-300 ease-in-out 
                         ${businessId ? (isMobileSidebarOpen && 'md:ml-0') || (!isMobileSidebarOpen && 'md:ml-64') : 'ml-0'}`}>
         
          {children}
        </main>
      </div>
    </div>
  );
}
