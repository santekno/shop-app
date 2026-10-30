import { Fragment } from "react";
import { Link, useMatches } from "react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/Breadcrumb.tsx";
import { breadcrumbsFrom } from "./route-crumbs.ts";

/**
 * "Dasbor › Produk" above every page, built from the matched routes'
 * `handle.crumb` (routes.tsx): adding a page to the route table adds its
 * breadcrumb, with no list to keep in step. Every step but the last is a
 * link; the last is the page on screen (aria-current="page").
 */
export function Breadcrumbs() {
  const crumbs = breadcrumbsFrom(useMatches());
  if (crumbs.length === 0) return null;

  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            // Two steps can share a path ("Dasbor" and "Ringkasan" are
            // both "/"), so the key is the path and the label.
            <Fragment key={`${crumb.to}:${crumb.label}`}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
