---
schemaVersion: 1
slug: arreglos-introduccion
title: Arreglos: un nombre para muchos datos
unitCode: unidad-2
order: 1
summary: Una primera aproximación a los arreglos en Java, sus índices y su recorrido.
unitTitle: Arreglos
estimatedMinutes: 45
tags: java, arreglos, índices
authoring: profe-macon-ai-workflow
---

Cuando un programa necesita guardar pocas cosas, podemos crear una variable para cada una. Pero imaginá que necesitamos guardar las notas de veinte estudiantes. Escribir veinte variables distintas funciona, pero hace que el programa sea difícil de recorrer, comparar y modificar.

Un arreglo permite guardar varios valores del mismo tipo bajo un único nombre. Cada valor ocupa una posición y podemos acceder a esa posición mediante un índice.

## 1. Un nombre, varias posiciones

En Java podemos crear un arreglo de enteros así:

~~~java
int[] notas = {7, 8, 9};
~~~

El nombre del arreglo es `notas`, pero dentro de él hay tres valores diferentes.

![Esquema de un arreglo con tres valores y los índices cero, uno y dos](/materiales/programacion-i/unidad-2/arreglos-introduccion/01-indices.svg)

### 1.1. Los índices

Las posiciones de un arreglo se identifican mediante índices.

- El primer elemento tiene índice `0`.
- El segundo elemento tiene índice `1`.
- El tercer elemento tiene índice `2`.
- Si el arreglo tiene tres elementos, el índice `3` ya queda fuera del arreglo.

Por eso podemos acceder a los valores anteriores escribiendo `notas[0]`, `notas[1]` y `notas[2]`.

> Idea central: la cantidad de elementos y el último índice no tienen el mismo número.


## 2. Recorrer el arreglo

Una ventaja importante de los arreglos es que podemos recorrer sus posiciones con una estructura repetitiva.

~~~java
int[] notas = {7, 8, 9};

for (int i = 0; i < notas.length; i++) {
    System.out.println(notas[i]);
}
~~~

La variable `i` va tomando los valores `0`, `1` y `2`. En cada vuelta, `notas[i]` representa un elemento diferente del arreglo.

El límite del `for` usa `notas.length`. Como el recorrido comienza en `0`, la condición debe ser `i < notas.length`.

## 3. El recorrido paso a paso

El mismo recorrido puede representarse como una secuencia:

~~~mermaid
flowchart LR
    A["i = 0<br/>notas[0] = 7"] --> B["i = 1<br/>notas[1] = 8"]
    B --> C["i = 2<br/>notas[2] = 9"]
    C --> D["i = 3<br/>termina el recorrido"]
~~~

El arreglo reúne varios datos relacionados; el índice permite elegir una posición y una estructura repetitiva permite recorrerlas sin escribir una instrucción diferente para cada elemento.
