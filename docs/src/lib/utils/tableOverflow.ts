type TableWrapper = HTMLDivElement & {
  _cleanup?: () => void;
};

function updateTableOverflow(wrapper: HTMLDivElement, table: HTMLTableElement) {
  const isOverflowing = table.scrollWidth > wrapper.clientWidth + 1;
  wrapper.classList.toggle("is-overflowing", isOverflowing);
  wrapper.toggleAttribute("data-overflowing", isOverflowing);
}

export function tableOverflow(node: HTMLElement) {
  let mutationObserver: MutationObserver;

  function enhanceTables() {
    mutationObserver?.disconnect();

    const tables = node.querySelectorAll("table");

    for (const table of tables) {
      let wrapper = table.parentElement;
      if (!wrapper?.classList.contains("table-scroll")) {
        wrapper = document.createElement("div");
        wrapper.className = "table-scroll";
        table.parentNode?.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }

      const tableWrapper = wrapper as TableWrapper;
      tableWrapper._cleanup?.();

      const resizeObserver = new ResizeObserver(() => {
        updateTableOverflow(tableWrapper, table as HTMLTableElement);
      });

      resizeObserver.observe(tableWrapper);
      resizeObserver.observe(table);
      updateTableOverflow(tableWrapper, table as HTMLTableElement);

      tableWrapper._cleanup = () => {
        resizeObserver.disconnect();
      };
    }

    mutationObserver?.observe(node, {
      childList: true,
      subtree: true,
    });
  }

  enhanceTables();

  mutationObserver = new MutationObserver(() => {
    enhanceTables();
  });

  mutationObserver.observe(node, {
    childList: true,
    subtree: true,
  });

  return () => {
    mutationObserver.disconnect();
    const wrappers = node.querySelectorAll(".table-scroll");
    for (const wrapper of wrappers) {
      (wrapper as TableWrapper)._cleanup?.();
    }
  };
}
