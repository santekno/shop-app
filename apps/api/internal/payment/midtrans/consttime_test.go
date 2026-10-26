package midtrans

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"

	"github.com/santekno/sdk/testx"
)

// TestCheckSignature_ComparesInConstantTime guards what no behavioural test
// can see: a signature compared with == (or bytes.Equal) gives the same
// answers as a constant-time compare, but its timing leaks how many leading
// characters were right, which is enough to forge a signature byte by byte.
// So the source of CheckSignature must compare through
// hashx.ConstantTimeEqual and must not compare strings or bytes any other
// way.
func TestCheckSignature_ComparesInConstantTime(t *testing.T) {
	fn := funcDecl(t, "midtrans.go", "CheckSignature")

	var constantTime, otherCompare []string
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch n := n.(type) {
		case *ast.CallExpr:
			sel, ok := n.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			pkg, ok := sel.X.(*ast.Ident)
			if !ok {
				return true
			}
			switch pkg.Name + "." + sel.Sel.Name {
			case "hashx.ConstantTimeEqual":
				constantTime = append(constantTime, sel.Sel.Name)
			case "bytes.Equal", "bytes.Compare", "strings.Compare", "strings.EqualFold", "reflect.DeepEqual":
				otherCompare = append(otherCompare, pkg.Name+"."+sel.Sel.Name)
			}
		case *ast.BinaryExpr:
			if n.Op == token.EQL || n.Op == token.NEQ {
				otherCompare = append(otherCompare, n.Op.String())
			}
		}
		return true
	})
	testx.AssertEqual(t, len(constantTime), 1, "CheckSignature must compare with hashx.ConstantTimeEqual exactly once")
	testx.AssertEqual(t, len(otherCompare), 0, "CheckSignature compares with %v, which is not constant time", otherCompare)

	// The comparison's result is what CheckSignature returns: a constant
	// compare whose result is thrown away protects nothing.
	last, ok := fn.Body.List[len(fn.Body.List)-1].(*ast.ReturnStmt)
	testx.AssertTrue(t, ok && len(last.Results) == 1, "CheckSignature ends in one return")
	call, ok := last.Results[0].(*ast.CallExpr)
	testx.AssertTrue(t, ok, "CheckSignature returns the comparison itself")
	sel, ok := call.Fun.(*ast.SelectorExpr)
	testx.AssertTrue(t, ok && sel.Sel.Name == "ConstantTimeEqual", "CheckSignature returns hashx.ConstantTimeEqual(...)")
}

// TestVerifySignature_UsesCheckSignature makes sure the client's own check,
// which the webhook and the status answer rely on, is CheckSignature and
// not a comparison of its own.
func TestVerifySignature_UsesCheckSignature(t *testing.T) {
	fn := funcDecl(t, "midtrans.go", "VerifySignature")
	calls := 0
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		if id, ok := n.(*ast.Ident); ok && id.Name == "CheckSignature" {
			calls++
		}
		if b, ok := n.(*ast.BinaryExpr); ok && (b.Op == token.EQL || b.Op == token.NEQ) {
			t.Errorf("VerifySignature compares with %s instead of CheckSignature", b.Op)
		}
		return true
	})
	testx.AssertEqual(t, calls, 1, "VerifySignature delegates to CheckSignature")
}

// funcDecl parses file of this package and returns the top-level function
// name.
func funcDecl(t *testing.T, file, name string) *ast.FuncDecl {
	t.Helper()
	f, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.SkipObjectResolution)
	testx.AssertNoError(t, err)
	for _, d := range f.Decls {
		if fn, ok := d.(*ast.FuncDecl); ok && fn.Name.Name == name && fn.Body != nil {
			return fn
		}
	}
	t.Fatalf("%s has no function %s", file, name)
	return nil
}
