import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="border-b border-black bg-[#f3f3f1] pt-12 pb-6 px-4 md:px-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <div className="font-mono text-xs mb-2 tracking-widest uppercase text-gray-500">
            Concept2 // Visualization
          </div>
          <h1 className="font-serif text-5xl md:text-7xl leading-[0.9] text-black">
            Rowing <br/>
            <span className="italic">Dynamics</span>
          </h1>
        </div>
        
        <div className="flex flex-col items-start md:items-end gap-2">
           <div className="font-mono text-[10px] uppercase tracking-widest mb-1">
            Data Source :: Concept 2
           </div>
           <a 
            href="https://github.com/Aeliu/concept2-backup" 
            target="_blank" 
            rel="noreferrer"
            className="group flex items-center gap-2 border border-black px-4 py-2 hover:bg-black hover:text-white transition-all duration-300"
          >
            <span className="font-mono text-xs uppercase tracking-wider">GitHub Source</span>
            <svg className="w-3 h-3 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </a>
        </div>
      </div>
    </header>
  );
};