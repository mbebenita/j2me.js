/*
 * Copyright 2013 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module J2ME.C4.Backend {
  import assert = Debug.assert;
  import unexpected = Debug.unexpected;
  import notImplemented = Debug.notImplemented;
  import pushUnique = ArrayUtilities.pushUnique;

  import Literal = AST.Literal;
  import Identifier = AST.Identifier;
  import VariableDeclaration = AST.VariableDeclaration;
  import VariableDeclarator = AST.VariableDeclarator;
  import MemberExpression = AST.MemberExpression;
  import BinaryExpression = AST.BinaryExpression;
  import CallExpression = AST.CallExpression;
  import AssignmentExpression = AST.AssignmentExpression;
  import ExpressionStatement = AST.ExpressionStatement;
  import ReturnStatement = AST.ReturnStatement;
  import FunctionDeclaration = AST.FunctionDeclaration;
  import ConditionalExpression = AST.ConditionalExpression;
  import ObjectExpression = AST.ObjectExpression;
  import ArrayExpression = AST.ArrayExpression;
  import UnaryExpression = AST.UnaryExpression;
  import NewExpression = AST.NewExpression;
  import Property = AST.Property;
  import BlockStatement = AST.BlockStatement;
  import ThisExpression = AST.ThisExpression;
  import ThrowStatement = AST.ThrowStatement;
  import IfStatement = AST.IfStatement;
  import WhileStatement = AST.WhileStatement;
  import BreakStatement = AST.BreakStatement;
  import ContinueStatement = AST.ContinueStatement;
  import SwitchStatement = AST.SwitchStatement;
  import SwitchCase = AST.SwitchCase;

  import Start = IR.Start;
  import Block = IR.Block;
  import Variable = IR.Variable;
  import Constant = IR.Constant;
  import Operator = IR.Operator;
  import Projection = IR.Projection;

  var Control = Looper.Control;

  import ControlNode = Looper.Control.ControlNode;
  import last = ArrayUtilities.last;

  Control.Break.prototype.compile = function (cx: Context): AST.Node {
    return cx.compileBreak(this);
  };

  Control.Continue.prototype.compile = function (cx: Context): AST.Node {
    return cx.compileContinue(this);
  };

  Control.Exit.prototype.compile = function (cx: Context): AST.Node {
    return cx.compileExit(this);
  };

  Control.LabelSwitch.prototype.compile = function (cx: Context): AST.Node {
    return cx.compileLabelSwitch(this);
  };

  Control.Seq.prototype.compile = function (cx: Context): AST.Node {
    return cx.compileSequence(this);
  };

  Control.Loop.prototype.compile = function (cx: Context): AST.Node {
    return cx.compileLoop(this);
  };

  Control.Switch.prototype.compile = function (cx: Context): AST.Node {
    return cx.compileSwitch(this);
  };

  Control.If.prototype.compile = function (cx: Context): AST.Node {
    return cx.compileIf(this);
  };

  Control.Try.prototype.compile = function (cx: Context): AST.Node {
    notImplemented("try");
    return null;
  };

  var F = new Identifier("$F");
  var C = new Identifier("$C");

  function isLazyConstant(value) {
    return false;
  }

  export function constant(value, cx?: Context): AST.Node {
    if (typeof value === "string" || value === null || value === true || value === false) {
      return new Literal(value);
    } else if (value === undefined) {
      return new Identifier("undefined");
    } else if (typeof value === "object" || typeof value === "function") {
      if (isLazyConstant(value)) {
        return call(property(F, "C"), [new Literal(cx.useConstant(value))]);
      } else {
        return new MemberExpression(C, new Literal(cx.useConstant(value)), true);
      }
    } else if (typeof value === "number" && isNaN(value)) {
      return new Identifier("NaN");
    } else if (value === Infinity) {
      return new Identifier("Infinity");
    } else if (value === -Infinity) {
      return new UnaryExpression("-", true, new Identifier("Infinity"));
    } else if (typeof value === "number" && (1 / value) < 0) {
      return new UnaryExpression("-", true, new Literal(Math.abs(value)));
    } else if (typeof value === "number") {
      return new Literal(value);
    } else {
      unexpected("Cannot emit constant for value: " + value);
    }
  }

  export function id(name) {
    release || assert (typeof name === "string");
    return new Identifier(name);
  }

  export function isIdentifierName(s) {
    if (!isIdentifierStart(s[0])) {
      return false;
    }
    for (var i = 1; i < s.length; i++) {
      if (!isIdentifierPart(s[i])) {
        return false;
      }
    }
    return true;
  }

  export function property(obj, ...args) {
    for (var i = 0; i < args.length; i++) {
      var x = args[i];
      if (typeof x === "string") {
        if (isIdentifierName(x)) {
          obj = new MemberExpression(obj, new Identifier(x), false);
        } else {
          obj = new MemberExpression(obj, new Literal(x), true);
        }
      } else if (x instanceof Literal && isIdentifierName(x.value)) {
        obj = new MemberExpression(obj, new Identifier(x.value), false);
      } else {
        obj = new MemberExpression(obj, x, true);
      }
    }
    return obj;
  }

  export function call(callee, args): CallExpression {
    release || assert(args instanceof Array);
    release || args.forEach(function (x) {
      release || assert(!(x instanceof Array));
      release || assert(x !== undefined);
    });
    return new CallExpression(callee, args);
  }

  function callAsCall(callee, object, args) {
    return call(property(callee, "asCall"), [object].concat(args));
  }

  export function callCall(callee, object, args) {
    return call(property(callee, "call"), [object].concat(args));
  }

  export function assignment(left, right) {
    release || assert(left && right);
    return new AssignmentExpression("=", left, right);
  }

  function variableDeclaration(declarations) {
    return new VariableDeclaration(declarations, "var");
  }

  function negate(node) {
    if (node instanceof Constant) {
      if (node.value === true || node.value === false) {
        return constant(!node.value);
      }
    } else if (node instanceof Identifier) {
      return new UnaryExpression(Operator.FALSE.name, true, node);
    }
    release || assert(node instanceof BinaryExpression || node instanceof UnaryExpression, node);
    var left = node instanceof BinaryExpression ? node.left : node.argument;
    var right = node.right;
    var operator = Operator.fromName(node.operator);
    if (operator === Operator.EQ && right instanceof Literal && right.value === false) {
      return left;
    }
    if (operator === Operator.FALSE) {
      return left;
    }
    if (operator.not) {
      if (node instanceof BinaryExpression) {
        return new BinaryExpression(operator.not.name, left, right);
      } else {
        return new UnaryExpression(operator.not.name, true, left);
      }
    }
    return new UnaryExpression(Operator.FALSE.name, true, node);
  }

  export class Context {
    label = new Variable("$L");
    variables = [];
    constants = [];
    parameters = [];

    useConstant(constant: IR.Constant): number {
      return pushUnique(this.constants, constant);
    }

    useVariable(variable: IR.Variable) {
      release || assert (variable);
      return pushUnique(this.variables, variable);
    }

    useParameter(parameter: IR.Parameter) {
      return this.parameters[parameter.index] = parameter;
    }

    compileLabelBody(node) {
      var body = [];
      if (node.label !== undefined) {
        this.useVariable(this.label);
        body.push(new ExpressionStatement(assignment(id(this.label.name), new Literal(node.label))));
      }
      return body;
    }

    compileBreak(node) {
      var body = this.compileLabelBody(node);
      body.push(new BreakStatement(null));
      return new BlockStatement(body);
    }

    compileContinue(node) {
      var body = this.compileLabelBody(node);
      body.push(new ContinueStatement(null));
      return new BlockStatement(body);
    }

    compileExit(node) {
      return new BlockStatement(this.compileLabelBody(node));
    }

    compileIf(node) {
      var cr = node.cond.compile(this);
      var tr = null, er = null;
      if (node.then) {
        tr = node.then.compile(this);
      }
      if (node.else) {
        er = node.else.compile(this);
      }
      var condition = compileValue(cr.end.predicate, this);
      condition = node.negated ? negate(condition) : condition;
      cr.body.push(new IfStatement(condition, tr || new BlockStatement([]), er || null));
      return cr;
    }

    compileSwitch(node) {
      var dr = node.determinant.compile(this);
      var cases = [];
      node.cases.forEach(function (x) {
        var br;
        if (x.body) {
          br = x.body.compile(this);
        }
        var test = typeof x.index === "number" ? new Literal(x.index) : undefined;
        cases.push(new SwitchCase(test, br ? [br] : []));
      }, this);
      var determinant = compileValue(dr.end.determinant, this);
      dr.body.push(new SwitchStatement(determinant, cases, false))
      return dr;
    }

    compileLabelSwitch(node) {
      var statement = null;
      var labelName = id(this.label.name);

      function compileLabelTest(labelID) {
        release || assert(typeof labelID === "number");
        return new BinaryExpression("===", labelName, new Literal(labelID));
      }

      for (var i = node.cases.length - 1; i >= 0; i--) {
        var c = node.cases[i];
        var labels = c.labels;

        var labelTest = compileLabelTest(labels[0]);

        for (var j = 1; j < labels.length; j++) {
          labelTest = new BinaryExpression("||", labelTest, compileLabelTest(labels[j]));
        }

        statement = new IfStatement(
          labelTest,
          c.body ? c.body.compile(this) : new BlockStatement([]),
          statement);
      }
      return statement;
    }

    compileLoop(node) {
      var br = node.body.compile(this);
      return new WhileStatement(constant(true), br);
    }

    compileSequence(node) {
      var cx = this;
      var body = [];
      node.body.forEach(function (x) {
        var result = x.compile(cx);
        if (result instanceof BlockStatement) {
          body = body.concat(result.body);
        } else {
          body.push(result);
        }
      });
      return new BlockStatement(body);
    }

    compileBlock(block) {
      var body = [];
      /*
      for (var i = 1; i < block.nodes.length - 1; i++) {
        print("Block[" + i + "]: " + block.nodes[i]);
      }
      */
      for (var i = 1; i < block.nodes.length - 1; i++) {
        var node = block.nodes[i];
        var statement;
        var to;
        var from;

        if (node instanceof IR.Throw) {
          statement = compileValue(node, this, true);
        } else {
          if (node instanceof IR.Move) {
            to = id(node.to.name);
            this.useVariable(node.to);
            from = compileValue(node.from, this);
          } else {
            from = compileValue(node, this, true);
            if (from instanceof AST.Statement) {
              body.push(from);
              continue;
            } else {
              if (node.variable) {
                to = id(node.variable.name);
                this.useVariable(node.variable);
              } else {
                to = null;
              }
            }
          }
          if (to) {
            statement = new ExpressionStatement(assignment(to, from));
          } else {
            statement = new ExpressionStatement(from);
          }
        }
        body.push(statement);
      }
      var end = last(block.nodes);
      if (end instanceof IR.Stop) {
        body.push(new ReturnStatement(compileValue(end.argument, this)));
      }
      var result = new BlockStatement(body);
      result.end = last(block.nodes);
      release || assert (result.end instanceof IR.End);
      // print("Block: " + block + " -> " + generateSource(result));
      return result;
    }
  }

  export function compileValue(value, cx: Context, noVariable?) {
    release || assert (value);
    release || assert (value.compile, "Implement |compile| for " + value + " (" + value.nodeName + ")");
    release || assert (cx instanceof Context);
    release || assert (!isArray(value));
    if (noVariable || !value.variable) {
      var node = value.compile(cx);
      return node;
    }
    release || assert (value.variable, "Value has no variable: " + value);
    return id(value.variable.name);
  }

  function isArray(array) {
    return array instanceof Array;
  }

  export function compileValues(values, cx: Context) {
    release || assert (isArray(values));
    return values.map(function (value) {
      return compileValue(value, cx);
    });
  }

  IR.Parameter.prototype.compile = function (cx: Context): AST.Node {
    cx.useParameter(this);
    return id(this.name);
  };

  IR.Constant.prototype.compile = function (cx: Context): AST.Node {
    return constant(this.value, cx);
  };

  IR.Variable.prototype.compile = function (cx: Context): AST.Node {
    return id(this.name);
  };

  IR.Phi.prototype.compile = function (cx: Context): AST.Node {
    release || assert (this.variable);
    return compileValue(this.variable, cx);
  };

  IR.Latch.prototype.compile = function (cx: Context): AST.Node {
    return new ConditionalExpression (
      compileValue(this.condition, cx),
      compileValue(this.left, cx),
      compileValue(this.right, cx)
    );
  };

  IR.Unary.prototype.compile = function (cx: Context): AST.Node {
    var result = new UnaryExpression (
      this.operator.name,
      true,
      compileValue(this.argument, cx)
    );
    if (this.operator === Operator.INEG) {
      return new BinaryExpression("|", result, constant(0));
    }
    // Float and double don't need conversion.
    return result;
  };

  IR.Copy.prototype.compile = function (cx: Context): AST.Node {
    return compileValue(this.argument, cx);
  };

  IR.Binary.prototype.compile = function (cx: Context): AST.Expression {
    var left = compileValue(this.left, cx);
    var right = compileValue(this.right, cx);
    var result = new BinaryExpression (this.operator.name, left, right);
    if (this.operator === Operator.IADD ||
        this.operator === Operator.ISUB ||
        this.operator === Operator.IMUL ||
        this.operator === Operator.IDIV ||
        this.operator === Operator.IREM) {
      return new BinaryExpression("|", result, constant(0));
    } else if (this.operator === Operator.FADD ||
               this.operator === Operator.FSUB ||
               this.operator === Operator.FMUL ||
               this.operator === Operator.FDIV ||
               this.operator === Operator.FREM) {
      return call(id("Math.fround"), [result]);
    } else if (this.operator === Operator.DADD ||
               this.operator === Operator.DSUB ||
               this.operator === Operator.DMUL ||
               this.operator === Operator.DDIV ||
               this.operator === Operator.DREM) {
      return new UnaryExpression("+", true, result);
    }
    return result;
  };

  IR.CallProperty.prototype.compile = function (cx: Context): AST.Node {
    var object = compileValue(this.object, cx);
    var name = compileValue(this.name, cx);
    var callee = property(object, name);
    var args = this.args.map(function (arg) {
      return compileValue(arg, cx);
    });
    return call(callee, args);
  };

  IR.Call.prototype.compile = function (cx: Context): AST.Node {
    var args = this.args.map(function (arg) {
      return compileValue(arg, cx);
    });
    var callee = compileValue(this.callee, cx);
    var object;
    if (this.object) {
      object = compileValue(this.object, cx);
    } else {
      object = new Literal(null);
    }
    return callCall(callee, object, args);
  };

  IR.This.prototype.compile = function (cx: Context): AST.Node {
    return new ThisExpression();
  };

  IR.Throw.prototype.compile = function (cx: Context): AST.Node {
    var argument = compileValue(this.argument, cx);
    return new ThrowStatement(argument);
  };

  IR.Arguments.prototype.compile = function (cx: Context): AST.Node {
    return id("arguments");
  };

  IR.GlobalProperty.prototype.compile = function (cx: Context): AST.Node {
    return id(this.name);
  };

  IR.GetProperty.prototype.compile = function (cx: Context): AST.Node {
    var object = compileValue(this.object, cx);
    var name = compileValue(this.name, cx);
    return property(object, name);
  };

  IR.SetProperty.prototype.compile = function (cx: Context): AST.Node {
    var object = compileValue(this.object, cx);
    var name = compileValue(this.name, cx);
    var value = compileValue(this.value, cx);
    return assignment(property(object, name), value);
  };

  IR.Projection.prototype.compile = function (cx: Context): AST.Node {
    release || assert (this.type === IR.ProjectionType.CONTEXT);
    release || assert (this.argument instanceof Start);
    return compileValue(this.argument.scope, cx);
  };

  IR.NewArray.prototype.compile = function (cx: Context): AST.Node {
    return new ArrayExpression(compileValues(this.elements, cx));
  };

  IR.NewObject.prototype.compile = function (cx: Context): AST.Node {
    var properties = this.properties.map(function (property) {
      var key = compileValue(property.key, cx);
      var value = compileValue(property.value, cx);
      return new Property(key, value, "init");
    });
    return new ObjectExpression(properties);
  };

  IR.Block.prototype.compile = function (cx: Context): AST.Node {
    return cx.compileBlock(this);
  };

  function generateSource(node) {
    return node.toSource();
  }

  export class Compilation {
    static id: number = 0;
    constructor(public parameters: string [],
                public body: string,
                public constants: any []) {
      // ...
    }

    /**
     * Object references are stored on the compilation object in a property called |constants|. Some of
     * these constants are |LazyInitializer|s and the backend makes sure to emit a call to a function
     * named |C| that resolves them.
     */
    public C(index: number) {
      var value = this.constants[index];
      // TODO: Avoid using |instanceof| here since this can be called quite frequently.
      if (value._isLazyInitializer) {
        this.constants[index] = value.resolve();
      }
      return this.constants[index];
    }
  }

  export function generate(cfg, checkUnwindEntryState: State): Compilation {
    enterTimeline("Looper");
    var root = Looper.analyze(cfg);
    leaveTimeline();

    var writer = new IndentingWriter();

    var cx = new Context();
    enterTimeline("Construct AST");
    var code = <BlockStatement>root.compile(cx);
    leaveTimeline();

    var parameters = [];
    for (var i = 0; i < cx.parameters.length; i++) {
      // Closure Compiler complains if the parameter names are the same even if they are not used,
      // so we differentiate them here.
      var name = cx.parameters[i] ? cx.parameters[i].name : "_" + i;
      parameters.push(id(name));
    }
    var compilationId = Compilation.id ++;
    var compilationGlobalPropertyName = "$$F" + compilationId;
    if (cx.constants.length) {
      var compilation = new Identifier(compilationGlobalPropertyName);
      var constants = new MemberExpression(compilation, new Identifier("constants"), false);
      code.body.unshift(variableDeclaration([
        new VariableDeclarator(id("$F"), compilation),
        new VariableDeclarator(id("$C"), constants)
      ]));
    }
    if (cx.variables.length) {
      countTimeline("Backend: Locals", cx.variables.length);
      var variables = variableDeclaration(cx.variables.map(function (variable) {
        return new VariableDeclarator(id(variable.name));
      }));
      code.body.unshift(variables);
    }

    if (checkUnwindEntryState) {
      code.body.unshift(compileUnwind(checkUnwindEntryState, cx, true));
    }

    enterTimeline("Serialize AST");
    var source = generateSource(code);
    leaveTimeline();
    // Save compilation as a globa property name.
    return jsGlobal[compilationGlobalPropertyName] = new Compilation (
      parameters.map(function (p) { return p.name; }),
      source,
      cx.constants
    );
  }
}
