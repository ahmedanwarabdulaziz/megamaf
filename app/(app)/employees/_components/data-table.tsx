"use client"

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import Link from "next/link"

interface Employee {
  id: string
  full_name: string
  username: string
  role: string
  is_active: boolean
  is_super_admin: boolean
  can_approve: boolean
}

export const columns: ColumnDef<Employee>[] = [
  {
    accessorKey: "full_name",
    header: "الاسم",
    cell: ({ row }) => {
       const id = row.original.id;
       return <Link href={`/employees/${id}`} className="text-primary hover:underline font-medium">{row.getValue("full_name")}</Link>
    }
  },
  {
    accessorKey: "username",
    header: "اسم المستخدم",
  },
  {
    accessorKey: "role",
    header: "الصلاحية",
    cell: ({ row }) => {
      const isSuper = row.original.is_super_admin;
      return isSuper ? "مدير نظام" : row.getValue("role") === "owner" ? "مالك" : "مستخدم";
    }
  },
  {
    accessorKey: "is_active",
    header: "الحالة",
    cell: ({ row }) => (row.getValue("is_active") ? "نشط" : "موقوف")
  },
]

export function EmployeeDataTable({ data }: { data: Employee[] }) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="text-right">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && "selected"}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                لا يوجد موظفين
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
