// Test of Byte method parseByte(String, radix).

// Copyright 2012 Red Hat, Inc.
// Written by Pavel Tisnovsky <ptisnovs@redhat.com>

// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published 
// by the Free Software Foundation, either version 2 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software Foundation
// Inc., 59 Temple Place - Suite 330, Boston, MA  02111-1307 USA

// Tags: JDK1.4
// Tags: CompileOptions: -source 1.4

package gnu.testlet.java.lang.Byte;
import gnu.testlet.Testlet;
import gnu.testlet.TestHarness;

/**
 * Test the method Byte.parseByte(String, radix);
 */
public class parseByteRadix implements Testlet
{
  public int getExpectedPass() { return 20; }
  public int getExpectedFail() { return 0; }
  public int getExpectedKnownFail() { return 0; }
  public void test (TestHarness harness)
  {
    byte b;

    b = Byte.parseByte("0", 2);
    harness.check(b, 0);
    b = Byte.parseByte("0", 10);
    harness.check(b, 0);
    b = Byte.parseByte("0", 16);
    harness.check(b, 0);
    b = Byte.parseByte("0", 36);
    harness.check(b, 0);

    b = Byte.parseByte("10", 8);
    harness.check(b, 8);
    b = Byte.parseByte("10", 10);
    harness.check(b, 10);
    b = Byte.parseByte("10", 16);
    harness.check(b, 16);

    b = Byte.parseByte("z", 36);
    harness.check(b, 35);

    b = Byte.parseByte("-80", 16);
    harness.check(b, Byte.MIN_VALUE);

    b = Byte.parseByte("7f", 16);
    harness.check(b, Byte.MAX_VALUE);

    try
      {
	b = Byte.parseByte("10", Character.MIN_RADIX - 1);
	harness.fail("too small radix");
      }
    catch (NumberFormatException nfe)
      {
	harness.check(true);
      }

    try
      {
	b = Byte.parseByte("10", Character.MAX_RADIX + 1);
	harness.fail("too small radix");
      }
    catch (NumberFormatException nfe)
      {
	harness.check(true);
      }

    try
      {
	b = Byte.parseByte("-129");
	harness.fail("-129 is to small for a byte");
      }
    catch (NumberFormatException nfe)
      {
	harness.check(true);
      }

    try
      {
	b = Byte.parseByte("128");
	harness.fail("128 is to big for a byte");
      }
    catch (NumberFormatException nfe)
      {
	harness.check(true);
      }

    try
      {
        b = Byte.parseByte("abc");
	harness.fail("Illegal input (abc) must throw NumberFormatException");
      }
    catch (NumberFormatException nfe)
      {
	harness.check(true);
      }

    try
      {
        b = Byte.parseByte("-");
	harness.fail("Single '-' must throw NumberFormatException");
      }
    catch (NumberFormatException nfe)
      {
	harness.check(true);
      }

    try
    {
      b = Byte.parseByte("+");
	harness.fail("Single '+' must throw NumberFormatException");
    }
  catch (NumberFormatException nfe)
    {
	harness.check(true);
    }
  
    // In JDK1.7, '+' is considered a valid character.
    // it means that the following step should be divided
    // for pre JDK1.7 case and >= JDK1.7
    if (conformToJDK17()) {
      try
        {
          b = Byte.parseByte("+10", 10);
          harness.check(true);
          harness.check(b, 10);
        }
      catch (NumberFormatException nfe)
        {
          harness.fail("'+10' string is not parsed correctly as expected in JDK1.7");
        }
      }
    else { // pre JDK1.7 branch
      try
        {
          b = Byte.parseByte("+10", 10);
          harness.fail("'+10' must throw NumberFormatException");
        }
      catch (NumberFormatException nfe)
        {
          harness.check(true);
        }
      }

    try
      {
        b = Byte.parseByte(null, 10);
	harness.fail("null input must throw NumberFormatException");
      }
    catch (NullPointerException npe)
      {
	harness.fail("null input must throw NumberFormatException, not NullPointerException");
      }
    catch (NumberFormatException nfe)
      {
	harness.check(true);
      }
    
    try
      {
        b = Byte.parseByte("", 10);
	harness.fail("empty input must throw NumberFormatException");
      }
    catch (IndexOutOfBoundsException ioobe)
      {
	harness.fail("empty input must throw NumberFormatException, not IndexOutOfBoundsException");
      }
    catch (NumberFormatException nfe)
      {
	harness.check(true);
      }
    }

  /**
    * Returns true if tested JRE conformns to JDK 1.7.
    * @author: Mark Wielaard
    */
  private static boolean conformToJDK17()
  {
      return false;
  }

}

