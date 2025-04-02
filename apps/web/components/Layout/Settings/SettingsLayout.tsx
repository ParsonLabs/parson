"use client"

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  User, 
  Server, 
  HardDrive, 
  Settings, 
  ChevronRight
} from 'lucide-react';

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  
  const navItems = [
    { 
      name: 'Profile', 
      href: '/settings', 
      icon: User,
      exact: true
    },
    { 
      name: 'Users', 
      href: '/settings/users', 
      icon: User,
      exact: false
    },
    { 
      name: 'Server', 
      href: '/settings/server', 
      icon: Server,
      exact: false
    },
    { 
      name: 'Library', 
      href: '/settings/library', 
      icon: HardDrive,
      exact: false
    },
  ];

  const isActive = (href: string, exact: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-900 to-black">
      <div className="max-w-7xl mx-auto pt-16 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="w-full md:w-64 shrink-0">
            <div className="sticky top-24">
              <div className="bg-zinc-900/70 backdrop-blur-md rounded-xl p-2 border border-zinc-800/50">
                <div className="flex items-center gap-3 px-4 py-3 mb-2">
                  <Settings className="w-5 h-5 text-purple-400" />
                  <h2 className="text-lg font-medium text-white">Settings</h2>
                </div>
                <nav className="space-y-1">
                  {navItems.map((item) => {
                    const isItemActive = isActive(item.href, item.exact);
                    return (
                      <Link 
                        key={item.href} 
                        href={item.href} 
                        className={`relative flex items-center px-4 py-3 rounded-lg transition-all duration-200 ${
                          isItemActive 
                            ? 'text-white bg-white/10' 
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {isItemActive && (
                          <motion.div 
                            layoutId="activeNavIndicator"
                            className="absolute left-0 w-1 h-6 bg-gradient-to-b from-purple-500 to-indigo-600 rounded-r-full" 
                          />
                        )}
                        <item.icon className={`w-5 h-5 mr-3 ${isItemActive ? 'text-purple-400' : ''}`} />
                        <span className="text-sm font-medium">{item.name}</span>
                        {isItemActive && <ChevronRight className="ml-auto w-4 h-4 text-gray-400" />}
                      </Link>
                    );
                  })}
                </nav>
              </div>
            </div>
          </div>

          <div className="flex-1">
            <div className="bg-zinc-900/70 backdrop-blur-md rounded-xl p-6 border border-zinc-800/50">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}