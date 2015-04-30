module J2ME {
  import Bytecodes = Bytecode.Bytecodes;
  var heapSize = 1024 * 1024;
  var buffer = new ArrayBuffer(heapSize * 4);
  import toHEX = IntegerUtilities.toHEX;
  var i4: Int32Array = new Int32Array(buffer);
  var u4: Uint32Array = new Uint32Array(buffer);
  var f4: Float32Array = new Float32Array(buffer);
  var o4 = ArrayUtilities.makeDenseArray(heapSize, null);

  var sbrk: number = 0;

  function malloc(size: number) {
    var address = sbrk;
    sbrk += size;
    return address;
  }

  /*
   *             +--------------------------------+ <-+-----------------------+
   *             | Parameter 0                    |   |                       |
   *             +--------------------------------+   |                       |
   *             |              ...               |   +-- argumentSlotCount   +-- argumentFramePointerOffset
   *             +--------------------------------+   |                       |
   *             | Parameter (P-1)                |   |                       |
   *             +--------------------------------+ <-+                       |
   *             | Caller Return Address          |   |                       |
   *             +--------------------------------+   |                       |
   *             | Caller FP                      |   |                       |
   *             +--------------------------------+   |                       |
   *             | Callee Method Info             |   |                       |
   *   FP  --->  +--------------------------------+ <-+-----------------------+
   *             | Non-Parameter Local 0          |
   *             +--------------------------------+
   *             |              ...               |
   *             +--------------------------------+
   *             | Non-Parameter Local (L-1)      |
   *             +--------------------------------+
   *             | Stack slot 0                   |
   *             +--------------------------------+
   *             |              ...               |
   *             +--------------------------------+
   *             | Stack slot (S-1)               |
   *   SP  --->  +--------------------------------+
   */

  enum FrameLayout {
    CalleeMethodInfoFramePointerOffset      = -1,
    CallerFramePointerFramePointerOffset    = -2,
    CallerReturnAddressFramePointerOffset   = -3,
    CallerSaveSize                          = 3
  }

  export class FrameView {
    public fp: number;
    public sp: number;
    public pc: number;
    constructor() {

    }

    set(fp: number, sp: number, pc: number) {
      this.fp = fp;
      this.sp = sp;
      this.pc = pc;
    }

    setParameterO4(v: Object, i: number) {
      // traceWriter.writeLn("Set Parameter: " + i + ", from: " + toHEX(fp + this.argumentFramePointerOffset + i));
      o4[this.fp + this.argumentFramePointerOffset + i] = v;
    }

    get methodInfo(): MethodInfo {
      return o4[this.fp + FrameLayout.CalleeMethodInfoFramePointerOffset];
    }

    set methodInfo(methodInfo: MethodInfo) {
      o4[this.fp + FrameLayout.CalleeMethodInfoFramePointerOffset] = methodInfo;
    }

    get argumentFramePointerOffset() {
      return -(3 + this.methodInfo.consumeArgumentSlots);
    }

    get stackOffset() {
      return this.methodInfo.codeAttribute.max_locals - this.methodInfo.consumeArgumentSlots;
    }

    trace(writer: IndentingWriter, fieldInfo: FieldInfo) {
      function toNumber(v) {
        if (v < 0) {
          return String(v);
        } else if (v === 0) {
          return " 0";
        } else {
          return "+" + v;
        }
      }
      var details = " ";
      if (fieldInfo) {
        details += "FieldInfo: " + fromUTF8(fieldInfo.utf8Name);
      }
      writer.writeLn("Frame: " + this.methodInfo.implKey + ", FP: " + this.fp + ", SP: " + this.sp + ", PC: " + this.pc + ", BC: " + Bytecodes[this.methodInfo.codeAttribute.code[this.pc]] + details);
      for (var i = this.fp + this.argumentFramePointerOffset; i < this.sp; i++) {
        var prefix = "    ";
        if (i >= this.fp + this.stackOffset) {
          prefix = "S" + (i - (this.fp + this.stackOffset)) + ": ";
        } else if (i === this.fp + FrameLayout.CalleeMethodInfoFramePointerOffset) {
          prefix = "MI: ";
        } else if (i === this.fp + FrameLayout.CallerFramePointerFramePointerOffset) {
          prefix = "CP: ";
        } else if (i === this.fp + FrameLayout.CallerReturnAddressFramePointerOffset) {
          prefix = "RA: ";
        } else if (i >= this.fp) {
          prefix = "L" + (i - this.fp) + ": ";
        } else {
          prefix = "P" + (i - (this.fp + this.argumentFramePointerOffset)) + ": ";
        }
        writer.writeLn(prefix + " " + toNumber(i - this.fp) + " " + toHEX(i) + ": " + String(i4[i]).padLeft(' ', 8) + " " + o4[i]);
      }
    }
  }

  export class Thread {

    /**
     * Thread base pointer.
     */
    tp: number;

    /**
     * Stack base pointer.
     */
    bp: number

    /**
     * Current frame pointer.
     */
    fp: number

    /**
     * Current stack pointer.
     */
    sp: number

    /**
     * Current program counter.
     */
    pc: number

    /**
     * Context associated with this thread.
     */
    ctx: Context;

    constructor(ctx: Context) {
      this.tp = malloc(1024 * 1024);
      this.bp = this.tp + 64;
      this.fp = this.bp;
      this.sp = -1;
      this.pc = 0;
      this.ctx = ctx;
    }
  }

  var frameView = new FrameView();


  export function interpret(thread: Thread) {
    frameView.set(thread.fp, thread.sp, thread.pc);
    var mi = frameView.methodInfo;
    var ci = mi.classInfo;
    var cp = ci.constantPool;

    var code = mi ? mi.codeAttribute.code : null;

    var fp = thread.fp;
    var sp = thread.sp;
    var pc = thread.pc;

    var argumentSlotCount = mi.consumeArgumentSlots;
    var argumentFramePointerOffset = frameView.argumentFramePointerOffset;

    var type, size;
    var value, index, array, object, constant, targetPC;
    var ia = 0, ib = 0;

    var fieldInfo;

    /** @inline */
    function i2l() {
      i4[sp] = i4[sp - 1] < 0 ? -1 : 0;
      sp++;
      // stack.push2(Long.fromInt(stack.pop()));
    }

    /** @inline */
    function popI4() {
      return i4[-- sp];
    }

    /** @inline */
    function pushI4(v: number) {
      i4[sp++] = v;
    }

    /** @inline */
    function popO4() {
      return o4[-- sp];
    }

    /** @inline */
    function pushO4(v: Object) {
      o4[sp++] = v;
    }

    /** @inline */
    function localFramePointerOffset(i: number) {
      return i < argumentSlotCount ? argumentFramePointerOffset + i : i - argumentSlotCount;
    }

    /** @inline */
    function getLocalO4(i: number) {
      traceWriter.writeLn("Get Local: " + i + ", from: " + toHEX(fp + localFramePointerOffset(i)));
      return o4[fp + localFramePointerOffset(i)];
    }

    /** @inline */
    function setLocalO4(v: Object, i: number) {
      traceWriter.writeLn("Set Local: " + i + ", from: " + toHEX(fp + localFramePointerOffset(i)));
      o4[fp + localFramePointerOffset(i)] = v;
    }

    /** @inline */
    function getLocalI4(i: number) {
      traceWriter.writeLn("Get Local: " + i + ", from: " + toHEX(fp + localFramePointerOffset(i)));
      return i4[fp + localFramePointerOffset(i)];
    }

    /** @inline */
    function setLocalI4(v: number, i: number) {
      traceWriter.writeLn("Set Local: " + i + ", from: " + toHEX(fp + localFramePointerOffset(i)));
      i4[fp + localFramePointerOffset(i)] = v;
    }

    /** @inline */
    function readI2() {
      return (code[pc++] << 8 | code[pc++]) << 16 >> 16;
    }

    /** @inline */
    function readTargetPC() {
      var offset = (code[pc] << 8 | code[pc + 1]) << 16 >> 16;
      var target = pc - 1 + offset;
      pc += 2;
      return target;
    }

    /** @inline */
    function popKind(kind: Kind) {
      switch(kind) {
        case Kind.Reference:
          return o4[--sp];
        case Kind.Long:
        case Kind.Double:
          sp--;
        default:
          return i4[--sp];
      }
    }

    /** @inline */
    function pushKind(kind: Kind, v: any) {
      switch(kind) {
        case Kind.Reference:
          return o4[sp++];
        case Kind.Long:
        case Kind.Double:
          sp++; // REDUX Broken
        default:
          return i4[sp++];
      }
    }

    while (true) {
      fieldInfo = null;
      var opPC = pc;
      var op = code[pc++];

      // var stack = []; for (var i = fp; i < sp; i++) stack.push(i4[i]);
      //var prefix = "FP: " + fp + ", SP: " + sp + ", PC: " + (pc - 1) + ", OP: " + Bytecodes[op];
      //prefix = prefix.padRight(' ', 64);
      //traceWriter.writeLn(prefix + ": STACK: [" + stack.join(", ") + "]");

      switch (op) {
        case Bytecodes.NOP:
          break;
        case Bytecodes.ACONST_NULL:
          o4[sp++] = null;
          break;
        case Bytecodes.ICONST_M1:
        case Bytecodes.ICONST_0:
        case Bytecodes.ICONST_1:
        case Bytecodes.ICONST_2:
        case Bytecodes.ICONST_3:
        case Bytecodes.ICONST_4:
        case Bytecodes.ICONST_5:
          pushI4(op - Bytecodes.ICONST_0);
          break;
        case Bytecodes.FCONST_0:
        case Bytecodes.FCONST_1:
        case Bytecodes.FCONST_2:
          pushI4(op - Bytecodes.FCONST_0);
          break;
        //        case Bytecodes.DCONST_0:
        //        case Bytecodes.DCONST_1:
        //          stack.push2(op - Bytecodes.DCONST_0);
        //          break;
        //        case Bytecodes.LCONST_0:
        //        case Bytecodes.LCONST_1:
        //          stack.push2(Long.fromInt(op - Bytecodes.LCONST_0));
        //          break;
        case Bytecodes.BIPUSH:
          pushI4(code[pc++] << 24 >> 24);
          break;
        //        case Bytecodes.SIPUSH:
        //          stack.push(frame.read16Signed());
        //          break;
        case Bytecodes.LDC:
        case Bytecodes.LDC_W:
          index = (op === Bytecodes.LDC) ? code[pc++] : readI2();
          constant = ci.constantPool.resolve(index, TAGS.CONSTANT_Any, false);
          pushI4(constant); // REDUX
          break;
        //        case Bytecodes.LDC2_W:
        //          index = frame.read16();
        //          constant = ci.constantPool.resolve(index, TAGS.CONSTANT_Any, false);
        //          stack.push2(constant);
        //          break;
        //        case Bytecodes.ILOAD:
        //          stack.push(frame.local[frame.read8()]);
        //          break;
        //        case Bytecodes.FLOAD:
        //          stack.push(frame.local[frame.read8()]);
        //          break;
        //        case Bytecodes.ALOAD:
        //          stack.push(frame.local[frame.read8()]);
        //          break;
        //        case Bytecodes.ALOAD_ILOAD:
        //          stack.push(frame.local[frame.read8()]);
        //          frame.pc ++;
        //          stack.push(frame.local[frame.read8()]);
        //          break;
        //        case Bytecodes.LLOAD:
        //        case Bytecodes.DLOAD:
        //          stack.push2(frame.local[frame.read8()]);
        //          break;
        //        case Bytecodes.ILOAD_0:
        //        case Bytecodes.ILOAD_1:
        //        case Bytecodes.ILOAD_2:
        //        case Bytecodes.ILOAD_3:
        //          stack.push(frame.local[op - Bytecodes.ILOAD_0]);
        //          break;
        //        case Bytecodes.FLOAD_0:
        //        case Bytecodes.FLOAD_1:
        //        case Bytecodes.FLOAD_2:
        //        case Bytecodes.FLOAD_3:
        //          stack.push(frame.local[op - Bytecodes.FLOAD_0]);
        //          break;
        case Bytecodes.ALOAD_0:
        case Bytecodes.ALOAD_1:
        case Bytecodes.ALOAD_2:
        case Bytecodes.ALOAD_3:
          pushO4(getLocalO4(op - Bytecodes.ALOAD_0));
          break;
        //        case Bytecodes.LLOAD_0:
        //        case Bytecodes.LLOAD_1:
        //        case Bytecodes.LLOAD_2:
        //        case Bytecodes.LLOAD_3:
        //          stack.push2(frame.local[op - Bytecodes.LLOAD_0]);
        //          break;
        //        case Bytecodes.DLOAD_0:
        //        case Bytecodes.DLOAD_1:
        //        case Bytecodes.DLOAD_2:
        //        case Bytecodes.DLOAD_3:
        //          stack.push2(frame.local[op - Bytecodes.DLOAD_0]);
        //          break;
        //        case Bytecodes.IALOAD:
        //        case Bytecodes.FALOAD:
        //        case Bytecodes.AALOAD:
        //        case Bytecodes.BALOAD:
        //        case Bytecodes.CALOAD:
        //        case Bytecodes.SALOAD:
        //          index = stack.pop();
        //          array = stack.pop();
        //          checkArrayBounds(array, index);
        //          stack.push(array[index]);
        //          break;
        //        case Bytecodes.LALOAD:
        //        case Bytecodes.DALOAD:
        //          index = stack.pop();
        //          array = stack.pop();
        //          checkArrayBounds(array, index);
        //          stack.push2(array[index]);
        //          break;
        //        case Bytecodes.ISTORE:
        //        case Bytecodes.FSTORE:
        //        case Bytecodes.ASTORE:
        //          frame.local[frame.read8()] = stack.pop();
        //          break;
        //        case Bytecodes.LSTORE:
        //        case Bytecodes.DSTORE:
        //          frame.local[frame.read8()] = stack.pop2();
        //          break;
        case Bytecodes.ISTORE_0:
        case Bytecodes.ISTORE_1:
        case Bytecodes.ISTORE_2:
        case Bytecodes.ISTORE_3:
          setLocalI4(popI4(), op - Bytecodes.ISTORE_0);
          break;
        case Bytecodes.FSTORE_0:
        case Bytecodes.FSTORE_1:
        case Bytecodes.FSTORE_2:
        case Bytecodes.FSTORE_3:
          setLocalI4(popI4(), op - Bytecodes.FSTORE_0);
          break;
        case Bytecodes.ASTORE_0:
        case Bytecodes.ASTORE_1:
        case Bytecodes.ASTORE_2:
        case Bytecodes.ASTORE_3:
          setLocalO4(popO4(), op - Bytecodes.ASTORE_0);
          break;
        //        case Bytecodes.LSTORE_0:
        //        case Bytecodes.DSTORE_0:
        //          frame.local[0] = stack.pop2();
        //          break;
        //        case Bytecodes.LSTORE_1:
        //        case Bytecodes.DSTORE_1:
        //          frame.local[1] = stack.pop2();
        //          break;
        //        case Bytecodes.LSTORE_2:
        //        case Bytecodes.DSTORE_2:
        //          frame.local[2] = stack.pop2();
        //          break;
        //        case Bytecodes.LSTORE_3:
        //        case Bytecodes.DSTORE_3:
        //          frame.local[3] = stack.pop2();
        //          break;
        case Bytecodes.IASTORE:
        case Bytecodes.FASTORE:
        case Bytecodes.BASTORE:
        case Bytecodes.CASTORE:
        case Bytecodes.SASTORE:
          value = popI4();
          index = popI4();
          array = popO4();
          checkArrayBounds(array, index);
          array[index] = value;
          break;
        //        case Bytecodes.LASTORE:
        //        case Bytecodes.DASTORE:
        //          value = stack.pop2();
        //          index = stack.pop();
        //          array = stack.pop();
        //          checkArrayBounds(array, index);
        //          array[index] = value;
        //          break;
        //        case Bytecodes.AASTORE:
        //          value = stack.pop();
        //          index = stack.pop();
        //          array = stack.pop();
        //          checkArrayBounds(array, index);
        //          checkArrayStore(array, value);
        //          array[index] = value;
        //          break;
        //        case Bytecodes.POP:
        //          stack.pop();
        //          break;
        //        case Bytecodes.POP2:
        //          stack.pop2();
        //          break;
        case Bytecodes.DUP:
          o4[sp] = o4[sp - 1]; i4[sp] = i4[sp - 1]; sp ++;
          break;
        //        case Bytecodes.DUP_X1:
        //          a = stack.pop();
        //          b = stack.pop();
        //          stack.push(a);
        //          stack.push(b);
        //          stack.push(a);
        //          break;
        //        case Bytecodes.DUP_X2:
        //          a = stack.pop();
        //          b = stack.pop();
        //          c = stack.pop();
        //          stack.push(a);
        //          stack.push(c);
        //          stack.push(b);
        //          stack.push(a);
        //          break;
        //        case Bytecodes.DUP2:
        //          a = stack.pop();
        //          b = stack.pop();
        //          stack.push(b);
        //          stack.push(a);
        //          stack.push(b);
        //          stack.push(a);
        //          break;
        //        case Bytecodes.DUP2_X1:
        //          a = stack.pop();
        //          b = stack.pop();
        //          c = stack.pop();
        //          stack.push(b);
        //          stack.push(a);
        //          stack.push(c);
        //          stack.push(b);
        //          stack.push(a);
        //          break;
        //        case Bytecodes.DUP2_X2:
        //          a = stack.pop();
        //          b = stack.pop();
        //          c = stack.pop();
        //          var d = stack.pop();
        //          stack.push(b);
        //          stack.push(a);
        //          stack.push(d);
        //          stack.push(c);
        //          stack.push(b);
        //          stack.push(a);
        //          break;
        //        case Bytecodes.SWAP:
        //          a = stack.pop();
        //          b = stack.pop();
        //          stack.push(a);
        //          stack.push(b);
        //          break;
        //        case Bytecodes.IINC:
        //          index = frame.read8();
        //          value = frame.read8Signed();
        //          frame.local[index] += value | 0;
        //          break;
        //        case Bytecodes.IINC_GOTO:
        //          index = frame.read8();
        //          value = frame.read8Signed();
        //          frame.local[index] += frame.local[index];
        //          frame.pc ++;
        //          frame.pc = frame.readTargetPC();
        //          break;
        //        case Bytecodes.IADD:
        //          stack.push((stack.pop() + stack.pop()) | 0);
        //          break;
        //        case Bytecodes.LADD:
        //          stack.push2(stack.pop2().add(stack.pop2()));
        //          break;
        //        case Bytecodes.FADD:
        //          stack.push(Math.fround(stack.pop() + stack.pop()));
        //          break;
        //        case Bytecodes.DADD:
        //          stack.push2(stack.pop2() + stack.pop2());
        //          break;
        //        case Bytecodes.ISUB:
        //          stack.push((-stack.pop() + stack.pop()) | 0);
        //          break;
        //        case Bytecodes.LSUB:
        //          stack.push2(stack.pop2().negate().add(stack.pop2()));
        //          break;
        //        case Bytecodes.FSUB:
        //          stack.push(Math.fround(-stack.pop() + stack.pop()));
        //          break;
        //        case Bytecodes.DSUB:
        //          stack.push2(-stack.pop2() + stack.pop2());
        //          break;
        //        case Bytecodes.IMUL:
        //          stack.push(Math.imul(stack.pop(), stack.pop()));
        //          break;
        //        case Bytecodes.LMUL:
        //          stack.push2(stack.pop2().multiply(stack.pop2()));
        //          break;
        //        case Bytecodes.FMUL:
        //          stack.push(Math.fround(stack.pop() * stack.pop()));
        //          break;
        //        case Bytecodes.DMUL:
        //          stack.push2(stack.pop2() * stack.pop2());
        //          break;
        //        case Bytecodes.IDIV:
        //          b = stack.pop();
        //          a = stack.pop();
        //          checkDivideByZero(b);
        //          stack.push((a === Constants.INT_MIN && b === -1) ? a : ((a / b) | 0));
        //          break;
        //        case Bytecodes.LDIV:
        //          b = stack.pop2();
        //          a = stack.pop2();
        //          checkDivideByZeroLong(b);
        //          stack.push2(a.div(b));
        //          break;
        //        case Bytecodes.FDIV:
        //          b = stack.pop();
        //          a = stack.pop();
        //          stack.push(Math.fround(a / b));
        //          break;
        //        case Bytecodes.DDIV:
        //          b = stack.pop2();
        //          a = stack.pop2();
        //          stack.push2(a / b);
        //          break;
        //        case Bytecodes.IREM:
        //          b = stack.pop();
        //          a = stack.pop();
        //          checkDivideByZero(b);
        //          stack.push(a % b);
        //          break;
        //        case Bytecodes.LREM:
        //          b = stack.pop2();
        //          a = stack.pop2();
        //          checkDivideByZeroLong(b);
        //          stack.push2(a.modulo(b));
        //          break;
        //        case Bytecodes.FREM:
        //          b = stack.pop();
        //          a = stack.pop();
        //          stack.push(Math.fround(a % b));
        //          break;
        //        case Bytecodes.DREM:
        //          b = stack.pop2();
        //          a = stack.pop2();
        //          stack.push2(a % b);
        //          break;
        case Bytecodes.INEG:
          i4[sp - 1] = -i4[sp - 1] | 0;
          break;
        //        case Bytecodes.LNEG:
        //          stack.push2(stack.pop2().negate());
        //          break;
        //        case Bytecodes.FNEG:
        //          stack.push(-stack.pop());
        //          break;
        //        case Bytecodes.DNEG:
        //          stack.push2(-stack.pop2());
        //          break;
        case Bytecodes.ISHL:
          ib = popI4();
          ia = popI4();
          pushI4(ia << ib);
          break;
        //        case Bytecodes.LSHL:
        //          b = stack.pop();
        //          a = stack.pop2();
        //          stack.push2(a.shiftLeft(b));
        //          break;
        case Bytecodes.ISHR:
          ib = popI4();
          ia = popI4();
          pushI4(ia >> ib);
          break;
        //        case Bytecodes.LSHR:
        //          b = stack.pop();
        //          a = stack.pop2();
        //          stack.push2(a.shiftRight(b));
        //          break;
        case Bytecodes.IUSHR:
          ib = popI4();
          ia = popI4();
          pushI4(ia >>> ib);
          break;
        //        case Bytecodes.LUSHR:
        //          b = stack.pop();
        //          a = stack.pop2();
        //          stack.push2(a.shiftRightUnsigned(b));
        //          break;
        case Bytecodes.IAND:
          i4[sp - 2] &= popI4();
          break;
        //        case Bytecodes.LAND:
        //          stack.push2(stack.pop2().and(stack.pop2()));
        //          break;
        case Bytecodes.IOR:
          i4[sp - 2] |= popI4();
          break;
        //        case Bytecodes.LOR:
        //          stack.push2(stack.pop2().or(stack.pop2()));
        //          break;
        case Bytecodes.IXOR:
          i4[sp - 2] ^= popI4();
          break;
        //        case Bytecodes.LXOR:
        //          stack.push2(stack.pop2().xor(stack.pop2()));
        //          break;
        //        case Bytecodes.LCMP:
        //          b = stack.pop2();
        //          a = stack.pop2();
        //          if (a.greaterThan(b)) {
        //            stack.push(1);
        //          } else if (a.lessThan(b)) {
        //            stack.push(-1);
        //          } else {
        //            stack.push(0);
        //          }
        //          break;
        //        case Bytecodes.FCMPL:
        //          b = stack.pop();
        //          a = stack.pop();
        //          if (isNaN(a) || isNaN(b)) {
        //            stack.push(-1);
        //          } else if (a > b) {
        //            stack.push(1);
        //          } else if (a < b) {
        //            stack.push(-1);
        //          } else {
        //            stack.push(0);
        //          }
        //          break;
        //        case Bytecodes.FCMPG:
        //          b = stack.pop();
        //          a = stack.pop();
        //          if (isNaN(a) || isNaN(b)) {
        //            stack.push(1);
        //          } else if (a > b) {
        //            stack.push(1);
        //          } else if (a < b) {
        //            stack.push(-1);
        //          } else {
        //            stack.push(0);
        //          }
        //          break;
        //        case Bytecodes.DCMPL:
        //          b = stack.pop2();
        //          a = stack.pop2();
        //          if (isNaN(a) || isNaN(b)) {
        //            stack.push(-1);
        //          } else if (a > b) {
        //            stack.push(1);
        //          } else if (a < b) {
        //            stack.push(-1);
        //          } else {
        //            stack.push(0);
        //          }
        //          break;
        //        case Bytecodes.DCMPG:
        //          b = stack.pop2();
        //          a = stack.pop2();
        //          if (isNaN(a) || isNaN(b)) {
        //            stack.push(1);
        //          } else if (a > b) {
        //            stack.push(1);
        //          } else if (a < b) {
        //            stack.push(-1);
        //          } else {
        //            stack.push(0);
        //          }
        //          break;
        case Bytecodes.IFEQ:
          targetPC = readTargetPC();
          if (popI4() === 0) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IFNE:
          targetPC = readTargetPC();
          if (popI4() !== 0) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IFLT:
          targetPC = readTargetPC();
          if (popI4() < 0) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IFGE:
          targetPC = readTargetPC();
          if (popI4() >= 0) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IFGT:
          targetPC = readTargetPC();
          if (popI4() > 0) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IFLE:
          targetPC = readTargetPC();
          if (popI4() <= 0) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IF_ICMPEQ:
          targetPC = readTargetPC();
          if (popI4() === popI4()) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IF_ICMPNE:
          targetPC = readTargetPC();
          if (popI4() !== popI4()) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IF_ICMPLT:
          targetPC = readTargetPC();
          if (popI4() > popI4()) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IF_ICMPGE:
          targetPC = readTargetPC();
          if (popI4() <= popI4()) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IF_ICMPGT:
          targetPC = readTargetPC();
          if (popI4() < popI4()) {
            pc = targetPC;
          }
          break;
        case Bytecodes.IF_ICMPLE:
          targetPC = readTargetPC();
          if (popI4() >= popI4()) {
            pc = targetPC;
          }
          break;
        //        case Bytecodes.IF_ACMPEQ:
        //          pc = frame.readTargetPC();
        //          if (stack.pop() === stack.pop()) {
        //            frame.pc = pc;
        //          }
        //          break;
        //        case Bytecodes.IF_ACMPNE:
        //          pc = frame.readTargetPC();
        //          if (stack.pop() !== stack.pop()) {
        //            frame.pc = pc;
        //          }
        //          break;
        //        case Bytecodes.IFNULL:
        //          pc = frame.readTargetPC();
        //          if (!stack.pop()) {
        //            frame.pc = pc;
        //          }
        //          break;
        //        case Bytecodes.IFNONNULL:
        //          pc = frame.readTargetPC();
        //          if (stack.pop()) {
        //            frame.pc = pc;
        //          }
        //          break;
        //        case Bytecodes.GOTO:
        //          frame.pc = frame.readTargetPC();
        //          break;
        //        case Bytecodes.GOTO_W:
        //          frame.pc = frame.read32Signed() - 1;
        //          break;
        //        case Bytecodes.JSR:
        //          pc = frame.read16();
        //          stack.push(frame.pc);
        //          frame.pc = pc;
        //          break;
        //        case Bytecodes.JSR_W:
        //          pc = frame.read32();
        //          stack.push(frame.pc);
        //          frame.pc = pc;
        //          break;
        //        case Bytecodes.RET:
        //          frame.pc = frame.local[frame.read8()];
        //          break;
        case Bytecodes.I2L:
          i2l();
          break;
        //        case Bytecodes.I2F:
        //          break;
        //        case Bytecodes.I2D:
        //          stack.push2(stack.pop());
        //          break;
        //        case Bytecodes.L2I:
        //          stack.push(stack.pop2().toInt());
        //          break;
        //        case Bytecodes.L2F:
        //          stack.push(Math.fround(stack.pop2().toNumber()));
        //          break;
        //        case Bytecodes.L2D:
        //          stack.push2(stack.pop2().toNumber());
        //          break;
        //        case Bytecodes.F2I:
        //          stack.push(util.double2int(stack.pop()));
        //          break;
        //        case Bytecodes.F2L:
        //          stack.push2(Long.fromNumber(stack.pop()));
        //          break;
        //        case Bytecodes.F2D:
        //          stack.push2(stack.pop());
        //          break;
        //        case Bytecodes.D2I:
        //          stack.push(util.double2int(stack.pop2()));
        //          break;
        //        case Bytecodes.D2L:
        //          stack.push2(util.double2long(stack.pop2()));
        //          break;
        //        case Bytecodes.D2F:
        //          stack.push(Math.fround(stack.pop2()));
        //          break;
        //        case Bytecodes.I2B:
        //          stack.push((stack.pop() << 24) >> 24);
        //          break;
        //        case Bytecodes.I2C:
        //          stack.push(stack.pop() & 0xffff);
        //          break;
        //        case Bytecodes.I2S:
        //          stack.push((stack.pop() << 16) >> 16);
        //          break;
        //        case Bytecodes.TABLESWITCH:
        //          frame.pc = frame.tableSwitch();
        //          break;
        //        case Bytecodes.LOOKUPSWITCH:
        //          frame.pc = frame.lookupSwitch();
        //          break;
        //        case Bytecodes.NEWARRAY:
        //          type = frame.read8();
        //          size = stack.pop();
        //          stack.push(newArray(PrimitiveClassInfo["????ZCFDBSIJ"[type]].klass, size));
        //          break;
        //        case Bytecodes.ANEWARRAY:
        //          index = frame.read16();
        //          classInfo = resolveClass(index, mi.classInfo);
        //          classInitAndUnwindCheck(classInfo, frame.pc - 3);
        //          size = stack.pop();
        //          stack.push(newArray(classInfo.klass, size));
        //          break;
        //        case Bytecodes.MULTIANEWARRAY:
        //          index = frame.read16();
        //          classInfo = resolveClass(index, mi.classInfo);
        //          var dimensions = frame.read8();
        //          var lengths = new Array(dimensions);
        //          for (var i = 0; i < dimensions; i++)
        //            lengths[i] = stack.pop();
        //          stack.push(J2ME.newMultiArray(classInfo.klass, lengths.reverse()));
        //          break;
        //        case Bytecodes.ARRAYLENGTH:
        //          array = stack.pop();
        //          stack.push(array.length);
        //          break;
        //        case Bytecodes.ARRAYLENGTH_IF_ICMPGE:
        //          array = stack.pop();
        //          stack.push(array.length);
        //          frame.pc ++;
        //          pc = frame.readTargetPC();
        //          if (stack.pop() <= stack.pop()) {
        //            frame.pc = pc;
        //          }
        //          break;
        case Bytecodes.GETFIELD:
          index = readI2();
          fieldInfo = cp.resolveField(index, false);
          object = popO4();
          pushKind(fieldInfo.kind, fieldInfo.get(object));
          // frame.patch(3, Bytecodes.GETFIELD, Bytecodes.RESOLVED_GETFIELD);
          break;
        //        case Bytecodes.RESOLVED_GETFIELD:
        //          fieldInfo = <FieldInfo><any>rp[frame.read16()];
        //          object = stack.pop();
        //          stack.pushKind(fieldInfo.kind, fieldInfo.get(object));
        //          break;
        case Bytecodes.PUTFIELD:
          index = readI2();
          fieldInfo = cp.resolveField(index, false);
          value = popKind(fieldInfo.kind);
          object = popO4();
          fieldInfo.set(object, value);
          // frame.patch(3, Bytecodes.PUTFIELD, Bytecodes.RESOLVED_PUTFIELD);
          break;
        //        case Bytecodes.RESOLVED_PUTFIELD:
        //          fieldInfo = <FieldInfo><any>rp[frame.read16()];
        //          value = stack.popKind(fieldInfo.kind);
        //          object = stack.pop();
        //          fieldInfo.set(object, value);
        //          break;
        //        case Bytecodes.GETSTATIC:
        //          index = frame.read16();
        //          fieldInfo = mi.classInfo.constantPool.resolveField(index, true);
        //          classInitAndUnwindCheck(fieldInfo.classInfo, frame.pc - 3);
        //          if (U) {
        //            return;
        //          }
        //          value = fieldInfo.getStatic();
        //          stack.pushKind(fieldInfo.kind, value);
        //          break;
        case Bytecodes.PUTSTATIC:
          index = readI2();
          fieldInfo = cp.resolveField(index, true);
          //classInitAndUnwindCheck(fieldInfo.classInfo, frame.pc - 3);
          //if (U) {
          //  return;
          //}
          fieldInfo.setStatic(popKind(fieldInfo.kind));
          break;
        //        case Bytecodes.PUTSTATIC:
        //          index = frame.read16();
        //          fieldInfo = mi.classInfo.constantPool.resolveField(index, true);
        //          classInitAndUnwindCheck(fieldInfo.classInfo, frame.pc - 3);
        //          if (U) {
        //            return;
        //          }
        //          fieldInfo.setStatic(stack.popKind(fieldInfo.kind));
        //          break;
        //        case Bytecodes.NEW:
        //          index = frame.read16();
        //          classInfo = resolveClass(index, mi.classInfo);
        //          classInitAndUnwindCheck(classInfo, frame.pc - 3);
        //          if (U) {
        //            return;
        //          }
        //          stack.push(newObject(classInfo.klass));
        //          break;
        //        case Bytecodes.CHECKCAST:
        //          index = frame.read16();
        //          classInfo = resolveClass(index, mi.classInfo);
        //          object = stack[stack.length - 1];
        //          if (object && !isAssignableTo(object.klass, classInfo.klass)) {
        //            throw $.newClassCastException(
        //                object.klass.classInfo.getClassNameSlow() + " is not assignable to " +
        //                classInfo.getClassNameSlow());
        //          }
        //          break;
        //        case Bytecodes.INSTANCEOF:
        //          index = frame.read16();
        //          classInfo = resolveClass(index, mi.classInfo);
        //          object = stack.pop();
        //          var result = !object ? false : isAssignableTo(object.klass, classInfo.klass);
        //          stack.push(result ? 1 : 0);
        //          break;
        //        case Bytecodes.ATHROW:
        //          object = stack.pop();
        //          if (!object) {
        //            throw $.newNullPointerException();
        //          }
        //          throw object;
        //          break;
        //        case Bytecodes.MONITORENTER:
        //          object = stack.pop();
        //          ctx.monitorEnter(object);
        //          if (U === VMState.Pausing || U === VMState.Stopping) {
        //            return;
        //          }
        //          break;
        //        case Bytecodes.MONITOREXIT:
        //          object = stack.pop();
        //          ctx.monitorExit(object);
        //          break;
        //        case Bytecodes.WIDE:
        //          frame.wide();
        //          break;
        //        case Bytecodes.RESOLVED_INVOKEVIRTUAL:
        //          index = frame.read16();
        //          var calleeMethodInfo = <MethodInfo><any>rp[index];
        //          var object = frame.peekInvokeObject(calleeMethodInfo);
        //
        //          calleeMethod = object[calleeMethodInfo.virtualName];
        //          var calleeTargetMethodInfo: MethodInfo = calleeMethod.methodInfo;
        //
        //          if (calleeTargetMethodInfo &&
        //              !calleeTargetMethodInfo.isSynchronized &&
        //              !calleeTargetMethodInfo.isNative &&
        //              calleeTargetMethodInfo.state !== MethodState.Compiled) {
        //            var calleeFrame = Frame.create(calleeTargetMethodInfo, []);
        //            ArrayUtilities.popManyInto(stack, calleeTargetMethodInfo.consumeArgumentSlots, calleeFrame.local);
        //            ctx.pushFrame(calleeFrame);
        //            frame = calleeFrame;
        //            mi = frame.methodInfo;
        //            mi.stats.interpreterCallCount ++;
        //            ci = mi.classInfo;
        //            rp = ci.constantPool.resolved;
        //            stack = frame.stack;
        //            lastPC = -1;
        //            continue;
        //          }
        //
        //          // Call directy.
        //          var returnValue;
        //          var argumentSlots = calleeMethodInfo.argumentSlots;
        //          switch (argumentSlots) {
        //            case 0:
        //              returnValue = calleeMethod.call(object);
        //              break;
        //            case 1:
        //              a = stack.pop();
        //              returnValue = calleeMethod.call(object, a);
        //              break;
        //            case 2:
        //              b = stack.pop();
        //              a = stack.pop();
        //              returnValue = calleeMethod.call(object, a, b);
        //              break;
        //            case 3:
        //              c = stack.pop();
        //              b = stack.pop();
        //              a = stack.pop();
        //              returnValue = calleeMethod.call(object, a, b, c);
        //              break;
        //            default:
        //              Debug.assertUnreachable("Unexpected number of arguments");
        //              break;
        //          }
        //          stack.pop();
        //          if (!release) {
        //            checkReturnValue(calleeMethodInfo, returnValue);
        //          }
        //          if (U) {
        //            return;
        //          }
        //          if (calleeMethodInfo.returnKind !== Kind.Void) {
        //            if (isTwoSlot(calleeMethodInfo.returnKind)) {
        //              stack.push2(returnValue);
        //            } else {
        //              stack.push(returnValue);
        //            }
        //          }
        //          break;
        //        case Bytecodes.INVOKEVIRTUAL:
        //        case Bytecodes.INVOKESPECIAL:
        //        case Bytecodes.INVOKESTATIC:
        //        case Bytecodes.INVOKEINTERFACE:
        //          index = frame.read16();
        //          if (op === Bytecodes.INVOKEINTERFACE) {
        //            frame.read16(); // Args Number & Zero
        //          }
        //          var isStatic = (op === Bytecodes.INVOKESTATIC);
        //
        //          // Resolve method and do the class init check if necessary.
        //          var calleeMethodInfo = mi.classInfo.constantPool.resolveMethod(index, isStatic);
        //
        //          // Fast path for some of the most common interpreter call targets.
        //          if (calleeMethodInfo.classInfo.getClassNameSlow() === "java/lang/Object" &&
        //              calleeMethodInfo.name === "<init>") {
        //            stack.pop();
        //            continue;
        //          }
        //
        //          if (isStatic) {
        //            classInitAndUnwindCheck(calleeMethodInfo.classInfo, lastPC);
        //            if (U) {
        //              return;
        //            }
        //          }
        //
        //          // Figure out the target method.
        //          var calleeTargetMethodInfo: MethodInfo = calleeMethodInfo;
        //          object = null;
        //          var calleeMethod: any;
        //          if (!isStatic) {
        //            object = frame.peekInvokeObject(calleeMethodInfo);
        //            switch (op) {
        //              case Bytecodes.INVOKEVIRTUAL:
        //                if (!calleeTargetMethodInfo.hasTwoSlotArguments &&
        //                    calleeTargetMethodInfo.argumentSlots < 4) {
        //                  frame.patch(3, Bytecodes.INVOKEVIRTUAL, Bytecodes.RESOLVED_INVOKEVIRTUAL);
        //                }
        //              case Bytecodes.INVOKEINTERFACE:
        //                var name = op === Bytecodes.INVOKEVIRTUAL ? calleeMethodInfo.virtualName : calleeMethodInfo.mangledName;
        //                calleeMethod = object[name];
        //                calleeTargetMethodInfo = calleeMethod.methodInfo;
        //                break;
        //              case Bytecodes.INVOKESPECIAL:
        //                checkNull(object);
        //                calleeMethod = getLinkedMethod(calleeMethodInfo);
        //                break;
        //            }
        //          } else {
        //            calleeMethod = getLinkedMethod(calleeMethodInfo);
        //          }
        //          // Call method directly in the interpreter if we can.
        //          if (calleeTargetMethodInfo && !calleeTargetMethodInfo.isNative && calleeTargetMethodInfo.state !== MethodState.Compiled) {
        //            var calleeFrame = Frame.create(calleeTargetMethodInfo, []);
        //            ArrayUtilities.popManyInto(stack, calleeTargetMethodInfo.consumeArgumentSlots, calleeFrame.local);
        //            ctx.pushFrame(calleeFrame);
        //            frame = calleeFrame;
        //            mi = frame.methodInfo;
        //            mi.stats.interpreterCallCount ++;
        //            ci = mi.classInfo;
        //            rp = ci.constantPool.resolved;
        //            stack = frame.stack;
        //            lastPC = -1;
        //            if (calleeTargetMethodInfo.isSynchronized) {
        //              if (!calleeFrame.lockObject) {
        //                frame.lockObject = calleeTargetMethodInfo.isStatic
        //                  ? calleeTargetMethodInfo.classInfo.getClassObject()
        //                  : frame.local[0];
        //              }
        //              ctx.monitorEnter(calleeFrame.lockObject);
        //              if (U === VMState.Pausing || U === VMState.Stopping) {
        //                return;
        //              }
        //            }
        //            continue;
        //          }
        //
        //          // Call directy.
        //          var returnValue;
        //          var argumentSlots = calleeMethodInfo.hasTwoSlotArguments ? -1 : calleeMethodInfo.argumentSlots;
        //          switch (argumentSlots) {
        //            case 0:
        //              returnValue = calleeMethod.call(object);
        //              break;
        //            case 1:
        //              a = stack.pop();
        //              returnValue = calleeMethod.call(object, a);
        //              break;
        //            case 2:
        //              b = stack.pop();
        //              a = stack.pop();
        //              returnValue = calleeMethod.call(object, a, b);
        //              break;
        //            case 3:
        //              c = stack.pop();
        //              b = stack.pop();
        //              a = stack.pop();
        //              returnValue = calleeMethod.call(object, a, b, c);
        //              break;
        //            default:
        //              if (calleeMethodInfo.hasTwoSlotArguments) {
        //                frame.popArgumentsInto(calleeMethodInfo, argArray);
        //              } else {
        //                popManyInto(stack, calleeMethodInfo.argumentSlots, argArray);
        //              }
        //              var returnValue = calleeMethod.apply(object, argArray);
        //          }
        //
        //          if (!isStatic) {
        //            stack.pop();
        //          }
        //
        //          if (!release) {
        //            checkReturnValue(calleeMethodInfo, returnValue);
        //          }
        //
        //          if (U) {
        //            return;
        //          }
        //
        //          if (calleeMethodInfo.returnKind !== Kind.Void) {
        //            if (isTwoSlot(calleeMethodInfo.returnKind)) {
        //              stack.push2(returnValue);
        //            } else {
        //              stack.push(returnValue);
        //            }
        //          }
        //          break;
        //
        //        case Bytecodes.LRETURN:
        //        case Bytecodes.DRETURN:
        //          returnValue = stack.pop();
        //        case Bytecodes.IRETURN:
        //        case Bytecodes.FRETURN:
        //        case Bytecodes.ARETURN:
        //          returnValue = stack.pop();
        //        case Bytecodes.RETURN:
        //          var callee = ctx.popFrame();
        //          if (callee.lockObject) {
        //            ctx.monitorExit(callee.lockObject);
        //          }
        //          callee.free();
        //          frame = ctx.current();
        //          if (Frame.isMarker(frame)) { // Marker or Start Frame
        //            if (op === Bytecodes.RETURN) {
        //              return undefined;
        //            }
        //            return returnValue;
        //          }
        //          mi = frame.methodInfo;
        //          ci = mi.classInfo;
        //          rp = ci.constantPool.resolved;
        //          stack = frame.stack;
        //          lastPC = -1;
        //          if (op === Bytecodes.RETURN) {
        //            // Nop.
        //          } else if (op === Bytecodes.LRETURN || op === Bytecodes.DRETURN) {
        //            stack.push2(returnValue);
        //          } else {
        //            stack.push(returnValue);
        //          }
        //          break;
        //        default:
        //          var opName = Bytecodes[op];
        //          throw new Error("Opcode " + opName + " [" + op + "] not supported.");

        case Bytecodes.NEWARRAY:
          type = code[pc++];
          size = popI4();
          o4[sp++] = newArray(PrimitiveClassInfo["????ZCFDBSIJ"[type]].klass, size);
          break;
        case Bytecodes.RETURN:
          // ctx.popFrame();
          if (sp === fp) {
            return;
          }
          return;
        case Bytecodes.INVOKEVIRTUAL:
        case Bytecodes.INVOKESPECIAL:
        case Bytecodes.INVOKESTATIC:
        case Bytecodes.INVOKEINTERFACE:
          index = readI2();
          if (op === Bytecodes.INVOKEINTERFACE) {
            pc += 2; // Args Number & Zero
          }
          var isStatic = (op === Bytecodes.INVOKESTATIC);

          // Resolve method and do the class init check if necessary.
          var calleeMethodInfo = cp.resolveMethod(index, isStatic);
          var calleeTargetMethodInfo = calleeMethodInfo;

          traceWriter.writeLn("Calling: " + calleeMethodInfo.implKey);

          var callee;
          var result;
          var object = null;
          if (!isStatic) {
            object = o4[sp - calleeMethodInfo.argumentSlots - 1];
          }
          switch (op) {
            case Bytecodes.INVOKESPECIAL:
              checkNull(object);
            case Bytecodes.INVOKESTATIC:
              callee = getLinkedMethod(calleeMethodInfo);
              break;
            case Bytecodes.INVOKEVIRTUAL:
            case Bytecodes.INVOKEINTERFACE:
              var name = op === Bytecodes.INVOKEVIRTUAL ? calleeMethodInfo.virtualName : calleeMethodInfo.mangledName;
              callee = object[name];
              calleeTargetMethodInfo = callee.methodInfo;
              break;
            default:
              traceWriter.writeLn("Not Implemented: " + Bytecodes[op]);
          }

          if (calleeTargetMethodInfo.isNative) {
            // Pop Arguments
            result = callee.call(object);
            if (calleeMethodInfo.returnKind !== Kind.Void) {
              pushKind(calleeMethodInfo.returnKind, result);
            }
            break;
          }

          mi = calleeTargetMethodInfo;
          ci = mi.classInfo;
          cp = ci.constantPool;

          pushI4(pc); // Save Return Address
          pushI4(fp); // Save Caller Frame Pointer
          pushO4(mi); // Save Callee Method Info

          fp = sp;
          sp = fp + mi.codeAttribute.max_locals - mi.consumeArgumentSlots;

          //if (isStatic) {
          //  classInitAndUnwindCheck(calleeMethodInfo.classInfo, lastPC);
          //  if (U) {
          //    return;
          //  }
          //}
          break;
        default:
          traceWriter.writeLn("Not Implemented: " + Bytecodes[op]);
          break;
      }

      frameView.set(fp, sp, opPC);
      traceWriter.writeLn();
      frameView.trace(traceWriter, fieldInfo);
    }
  }
}
